from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session as DbSession

from app.auth import SESSION_COOKIE, authenticate, close_session, current_user, open_session, register
from app.config import get_settings
from app.db import get_db
from app.models import User

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


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30
    )


def _to_out(user: User) -> UserOut:
    return UserOut(id=str(user.id), name=user.name, email=user.email, locale=user.locale)


@router.post("/register", response_model=UserOut, status_code=201)
def register_route(payload: RegisterIn, response: Response, db: DbSession = Depends(get_db)):
    if get_settings().signup_mode != "open":
        raise HTTPException(status_code=403, detail="signup_disabled")
    try:
        user = register(db, name=payload.name, email=payload.email, password=payload.password)
    except ValueError:
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
