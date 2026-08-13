from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.api.invite_routes import as_http
from app.auth import (
    SESSION_COOKIE,
    SESSION_TTL,
    authenticate,
    change_password,
    close_other_sessions,
    close_session,
    current_user,
    open_session,
    register,
)
from app.config import get_settings
from app.db import get_db
from app.email_verification import (
    VerificationError,
    confirm_email,
    send_verification,
    sent_recently,
)
from app.invitations import InvitationError, Status, by_token, check_recipient, status_of
from app.locales import locale_from_request
from app.models import Invitation, User
from app.rate_limit import client_key
from app.settings_input import check_locale
from app.text import normalize_email
from app import throttle

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    #: Приглашение, по которому человек пришёл. С ним аккаунт заводится сразу
    #: внутри позвавшей организации — и заводится даже в установке, где
    #: свободная регистрация выключена.
    invite_token: str | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class VerifyEmailIn(BaseModel):
    token: str = Field(min_length=1, max_length=200)


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    locale: str
    # Не дата, а признак: интерфейсу нужно решить, показывать ли полоску
    # «подтвердите адрес», а точное время подтверждения ему не нужно ни для
    # чего — и не стоит того, чтобы разбирать формат даты на клиенте.
    email_verified: bool


class MailResultOut(BaseModel):
    """Ушло письмо или нет. Врать «отправлено» нельзя: человек будет ждать."""

    sent: bool


def _cookie_is_secure(request: Request) -> bool:
    """Ставить ли на куку флаг Secure.

    Порядок источников — от явного к выведенному. COOKIE_SECURE, если задан,
    решает всё: это рубильник для установок, где автоматика ошибается. Дальше
    — сам запрос: схема https или X-Forwarded-Proto от прокси значят, что
    кука поедет по защищённому каналу, каким бы ни был PUBLIC_BASE_URL (тот
    бывает не задан вовсе — и тогда прежний вывод «только из него» отправлял
    куку боевой установки без Secure). PUBLIC_BASE_URL остаётся последним
    источником — для запросов, пришедших в обход прокси.
    """
    settings = get_settings()
    if settings.cookie_secure is not None:
        return settings.cookie_secure
    if request.url.scheme == "https":
        return True
    if request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https":
        return True
    return settings.public_base_url.startswith("https://")


def _cookie_attributes(request: Request) -> dict:
    """Атрибуты куки, общие для установки и удаления.

    Одним словарём, потому что браузер удаляет куку только при совпадении
    атрибутов: delete_cookie с другим набором оставляет старую куку жить.
    """
    return {
        "httponly": True,
        "samesite": "lax",
        "secure": _cookie_is_secure(request),
    }


def _set_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        # Ровно столько же, сколько живёт сама сессия в базе: два числа,
        # заданных порознь, однажды разъедутся, и кука переживёт сессию
        # (или наоборот) без единого признака в коде.
        max_age=int(SESSION_TTL.total_seconds()),
        **_cookie_attributes(request),
    )


def _to_out(user: User) -> UserOut:
    return UserOut(
        id=str(user.id),
        name=user.name,
        email=user.email,
        locale=user.locale,
        email_verified=user.email_verified_at is not None,
    )


def _invitation_for_signup(db: DbSession, payload: RegisterIn) -> Invitation | None:
    """Приглашение из формы регистрации, проверенное до создания аккаунта.

    Проверка идёт здесь, а не внутри register(): человек, чья ссылка
    просрочена, должен прочитать про ссылку, а не завести аккаунт и получить
    отказ уже после. Тот же набор кодов, что и у приёма по ссылке, — экран
    регистрации и экран приглашения объясняют одно и то же одинаково.
    """
    if not payload.invite_token:
        return None

    invitation = by_token(db, payload.invite_token)
    if invitation is None:
        raise HTTPException(status_code=404, detail="invite_not_found")

    state = status_of(invitation, datetime.now(timezone.utc))
    if state is not Status.PENDING:
        raise HTTPException(status_code=409, detail=f"invite_{state.value}")

    try:
        # Адрес приглашения не редактируется: форма его подставляет, а сервер
        # не верит форме. Иначе приглашение с адресом становится приглашением
        # предъявителю, чего оно как раз и не должно допускать.
        check_recipient(invitation, str(payload.email))
    except InvitationError as error:
        raise as_http(error)
    return invitation


@router.post("/register", response_model=UserOut, status_code=201)
def register_route(
    payload: RegisterIn,
    response: Response,
    request: Request,
    db: DbSession = Depends(get_db),
    accept_language: str | None = Header(default=None),
):
    settings = get_settings()
    mode = settings.signup_mode
    # `closed` проверяется до приглашения: в такой установке регистрации нет
    # вовсе, и отвечать на неё разбором чужой ссылки не за чем.
    if mode == "closed":
        raise HTTPException(status_code=403, detail="signup_disabled")

    # Предел до любых проверок и до создания чего бы то ни было: массовое
    # заведение аккаунтов — это спам в базе и поток писем с подтверждениями
    # с нашего же отправителя.
    if not throttle.hit(
        db,
        f"signup:ip:{client_key(request)}",
        limit=settings.signup_rate_limit_per_ip,
        window_seconds=settings.auth_rate_window_seconds,
    ):
        raise HTTPException(status_code=429, detail="too_many_requests")

    invitation = _invitation_for_signup(db, payload)
    if mode == "invite_only" and invitation is None:
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
            invitation=invitation,
        )
    except InvitationError as error:
        raise as_http(error)
    except ValueError:
        raise HTTPException(status_code=409, detail="email_taken")
    except IntegrityError:
        # Защитная сетка на случай гонки, не пойманной внутри register()
        # (например, если состав вставок там изменится в будущем): без
        # отката сессия остаётся в прерванном состоянии, а без этой ветки
        # клиент получил бы 500 вместо честного «адрес занят».
        db.rollback()
        raise HTTPException(status_code=409, detail="email_taken")
    _set_cookie(
        response,
        request,
        open_session(db, user, active_org_id=invitation.org_id if invitation else None),
    )
    # Письмо уходит синхронно, но регистрацию не решает: недоступный
    # почтовый сервер не повод не пускать человека в только что созданную
    # организацию. Отказ уже записан в журнал внутри mail.send, повторная
    # отправка доступна отдельным маршрутом.
    send_verification(db, user)
    return _to_out(user)


@router.post("/login", response_model=UserOut)
def login_route(
    payload: LoginIn, response: Response, request: Request, db: DbSession = Depends(get_db)
):
    """Вход. Два предела частоты — на два разных способа перебора.

    По IP считаются все попытки: один адрес, молотящий вход, — это перебор
    паролей по словарю, чьи бы адреса он ни пробовал. По аккаунту — только
    неудачи: это перебор паролей к конкретному человеку с многих адресов, и
    считать успехи здесь нельзя — успешный вход с двух устройств заперал бы
    владельца. Счётчики в базе, а не в памяти процесса: перезапуск или
    вторая реплика не должны обнулять предел (см. app.throttle).
    """
    settings = get_settings()
    if not throttle.hit(
        db,
        f"login:ip:{client_key(request)}",
        limit=settings.login_rate_limit_per_ip,
        window_seconds=settings.auth_rate_window_seconds,
    ):
        raise HTTPException(status_code=429, detail="too_many_requests")

    account_bucket = f"login:account:{normalize_email(str(payload.email))}"
    if not throttle.check(
        db,
        account_bucket,
        limit=settings.login_rate_limit_per_account,
        window_seconds=settings.auth_rate_window_seconds,
    ):
        raise HTTPException(status_code=429, detail="too_many_requests")

    user = authenticate(db, email=payload.email, password=payload.password)
    if user is None:
        throttle.note(db, account_bucket)
        raise HTTPException(status_code=401, detail="bad_credentials")
    _set_cookie(response, request, open_session(db, user))
    return _to_out(user)


@router.post("/logout", status_code=204)
def logout_route(
    response: Response,
    request: Request,
    db: DbSession = Depends(get_db),
    flowline_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
):
    if flowline_session:
        close_session(db, flowline_session)
    # Те же атрибуты, что и при установке: браузер сверяет их и с другим
    # набором оставил бы куку на месте.
    response.delete_cookie(SESSION_COOKIE, **_cookie_attributes(request))


@router.get("/me", response_model=UserOut)
def me_route(user: User = Depends(current_user)):
    return _to_out(user)


class PasswordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


@router.post("/password", status_code=204)
def change_password_route(
    payload: PasswordIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
    flowline_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
):
    """Смена пароля. Требует прежний: одной сессии для этого мало —
    иначе украденная кука меняла бы пароль владельцу.

    Остальные сессии закрываются тут же: смена пароля — это обычно ответ на
    подозрение, что он утёк, и оставлять чужие входы жить дальше значило бы
    делать вид, что смена что-то решила. Текущая сессия остаётся.
    """
    try:
        change_password(
            db, user, current=payload.current_password, new=payload.new_password
        )
    except ValueError:
        raise HTTPException(status_code=403, detail="bad_credentials")
    close_other_sessions(db, user, keep_raw_token=flowline_session)


class SessionsClosedOut(BaseModel):
    closed: int


@router.post("/sessions/close-others", response_model=SessionsClosedOut)
def close_other_sessions_route(
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
    flowline_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
):
    """«Выйти на всех устройствах», кроме этого."""
    return SessionsClosedOut(
        closed=close_other_sessions(db, user, keep_raw_token=flowline_session)
    )


@router.post("/verify-email", status_code=204)
def verify_email_route(payload: VerifyEmailIn, db: DbSession = Depends(get_db)):
    """Погашение ссылки из письма. Куки не требует.

    Ссылку открывают в том браузере, куда пришла почта, а не обязательно в
    том, где открыта сессия. Требовать вход значило бы ломать самый обычный
    сценарий — письмо на телефоне, работа на ноутбуке; сам токен при этом
    одноразовый, живёт сутки и достаточно длинный, чтобы его нельзя было
    подобрать.
    """
    try:
        confirm_email(db, payload.token)
    except VerificationError as exc:
        raise HTTPException(status_code=400, detail=exc.code)


@router.post("/verify-email/resend", response_model=MailResultOut)
def resend_verification_route(
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    if user.email_verified_at is not None:
        raise HTTPException(status_code=409, detail="already_verified")
    if sent_recently(db, user):
        raise HTTPException(status_code=429, detail="too_many_requests")
    return MailResultOut(sent=send_verification(db, user))


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
