from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.auth import (
    SESSION_COOKIE,
    SESSION_TTL,
    authenticate,
    close_session,
    current_user,
    open_session,
    register,
)
from app.config import get_settings
from app.db import get_db
from app.locales import locale_from_request
from app.models import User
from app.settings_input import check_locale

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    locale: str


def _cookie_is_secure() -> bool:
    """Secure выводится из уже существующего PUBLIC_BASE_URL, а не из
    отдельного рубильника: боевая установка на https защищена автоматически,
    локальная разработка на http продолжает работать, и деплойщику не нужно
    помнить про ещё одну переменную окружения."""
    return get_settings().public_base_url.startswith("https://")


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=_cookie_is_secure(),
        # Ровно столько же, сколько живёт сама сессия в базе: два числа,
        # заданных порознь, однажды разъедутся, и кука переживёт сессию
        # (или наоборот) без единого признака в коде.
        max_age=int(SESSION_TTL.total_seconds()),
    )


def _to_out(user: User) -> UserOut:
    return UserOut(id=str(user.id), name=user.name, email=user.email, locale=user.locale)


@router.post("/register", response_model=UserOut, status_code=201)
def register_route(
    payload: RegisterIn,
    response: Response,
    db: DbSession = Depends(get_db),
    accept_language: str | None = Header(default=None),
):
    if get_settings().signup_mode != "open":
        raise HTTPException(status_code=403, detail="signup_disabled")
    try:
        user = register(
            db,
            name=payload.name,
            email=payload.email,
            password=payload.password,
            # Единственное место, где заголовок вообще читается: язык при
            # первом появлении человека. Дальше он живёт в профиле.
            locale=locale_from_request(accept_language),
        )
    except ValueError:
        raise HTTPException(status_code=409, detail="email_taken")
    except IntegrityError:
        # Защитная сетка на случай гонки, не пойманной внутри register()
        # (например, если состав вставок там изменится в будущем): без
        # отката сессия остаётся в прерванном состоянии, а без этой ветки
        # клиент получил бы 500 вместо честного «адрес занят».
        db.rollback()
        raise HTTPException(status_code=409, detail="email_taken")
    _set_cookie(response, open_session(db, user))
    return _to_out(user)


@router.post("/login", response_model=UserOut)
def login_route(payload: LoginIn, response: Response, db: DbSession = Depends(get_db)):
    user = authenticate(db, email=payload.email, password=payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="bad_credentials")
    _set_cookie(response, open_session(db, user))
    return _to_out(user)


@router.post("/logout", status_code=204)
def logout_route(
    response: Response,
    db: DbSession = Depends(get_db),
    flowline_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
):
    if flowline_session:
        close_session(db, flowline_session)
    response.delete_cookie(SESSION_COOKIE)


@router.get("/me", response_model=UserOut)
def me_route(user: User = Depends(current_user)):
    return _to_out(user)


class ProfileIn(BaseModel):
    """Уровень 4 настроек: язык интерфейса. Всё.

    Имя рядом с ним не настройка, а свойство человека, но правится оно там же
    и тем же запросом: заводить ради одного поля второй маршрут значило бы
    делать вид, что это разные экраны.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    locale: str | None = None


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: ProfileIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    """Правка своего профиля.

    Язык проверяется по списку поддерживаемых: непроверенное значение легло бы
    в профиль, и интерфейс молча падал бы на язык по умолчанию при каждом
    входе, не объясняя почему.
    """
    if payload.locale is not None:
        try:
            user.locale = check_locale(payload.locale)
        except ValueError:
            raise HTTPException(status_code=422, detail="unsupported_locale")
    if payload.name is not None:
        user.name = payload.name.strip()
    db.flush()
    return _to_out(user)
