import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.db import get_db
from app.models import Membership, Organization, Role, Session, User
from app.security import hash_password, hash_token, new_token, verify_password
from app.text import normalize_email, slugify

SESSION_COOKIE = "flowline_session"
SESSION_TTL = timedelta(days=30)


def _unique_org_slug(db: DbSession, name: str) -> str:
    base = slugify(name, fallback="org")
    if db.scalar(select(Organization).where(Organization.slug == base)) is None:
        return base
    return f"{base}-{secrets.token_hex(3)}"


def register(db: DbSession, *, name: str, email: str, password: str) -> User:
    normalized = normalize_email(email)
    if db.scalar(select(User).where(User.email == normalized)) is not None:
        raise ValueError("адрес уже занят")

    settings = get_settings()
    user = User(
        email=normalized,
        password_hash=hash_password(password),
        name=name.strip(),
        locale=settings.default_locale,
    )
    db.add(user)
    db.flush()

    org = Organization(name=name.strip(), slug=_unique_org_slug(db, name))
    db.add(org)
    db.flush()

    db.add(Membership(org_id=org.id, user_id=user.id, role=Role.OWNER))
    db.flush()
    return user


def authenticate(db: DbSession, *, email: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.email == normalize_email(email)))
    if user is None:
        return None
    return user if verify_password(password, user.password_hash) else None


def open_session(db: DbSession, user: User) -> str:
    raw, hashed = new_token()
    db.add(
        Session(
            user_id=user.id,
            token_hash=hashed,
            expires_at=datetime.now(timezone.utc) + SESSION_TTL,
        )
    )
    db.flush()
    return raw


def close_session(db: DbSession, raw_token: str) -> None:
    record = db.scalar(select(Session).where(Session.token_hash == hash_token(raw_token)))
    if record is not None:
        db.delete(record)


def current_user(
    flowline_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: DbSession = Depends(get_db),
) -> User:
    if not flowline_session:
        raise HTTPException(status_code=401, detail="not_authenticated")

    record = db.scalar(select(Session).where(Session.token_hash == hash_token(flowline_session)))
    if record is None or record.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="session_expired")

    return db.get(User, record.user_id)
