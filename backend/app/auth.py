import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.db import get_db
from app.models import Membership, Organization, Role, Session, User
from app.security import hash_password, hash_token, new_token, verify_password
from app.text import normalize_email, slugify

SESSION_COOKIE = "flowline_session"
SESSION_TTL = timedelta(days=30)

_MAX_SLUG_ATTEMPTS = 5

# Посчитан один раз при импорте модуля, а не на каждый запрос: используется в
# ветке authenticate(), где пользователь не найден, чтобы эта ветка стоила
# столько же по времени, сколько ветка с неверным паролем существующего
# пользователя. Без этого разница во времени ответа /api/auth/login выдаёт
# перебором, какие адреса зарегистрированы.
_DUMMY_PASSWORD_HASH = hash_password("timing-safety-dummy-password")


def _org_slug_candidate(db: DbSession, name: str, *, forced: bool) -> str:
    base = slugify(name, fallback="org")
    if not forced and db.scalar(select(Organization).where(Organization.slug == base)) is None:
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
    try:
        # SAVEPOINT: если конкурентный запрос успел вставить тот же адрес
        # между проверкой выше и этим flush(), откатывается только эта
        # вставка — не вся транзакция сессии.
        with db.begin_nested():
            db.add(user)
            db.flush()
    except IntegrityError as exc:
        raise ValueError("адрес уже занят") from exc

    org_name = name.strip()
    org: Organization | None = None
    last_error: IntegrityError | None = None
    for attempt in range(_MAX_SLUG_ATTEMPTS):
        candidate = Organization(
            name=org_name, slug=_org_slug_candidate(db, org_name, forced=attempt > 0)
        )
        try:
            with db.begin_nested():
                db.add(candidate)
                db.flush()
        except IntegrityError as exc:
            # Коллизия слага — не вина пользователя (его организация просто
            # называется как уже существующая); пробуем ещё раз с новым
            # случайным суффиксом, а не проваливаем регистрацию.
            last_error = exc
            continue
        org = candidate
        break
    if org is None:
        raise last_error

    db.add(Membership(org_id=org.id, user_id=user.id, role=Role.OWNER))
    db.flush()
    return user


def authenticate(db: DbSession, *, email: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.email == normalize_email(email)))
    if user is None:
        verify_password(password, _DUMMY_PASSWORD_HASH)
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
