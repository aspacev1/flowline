import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.db import get_db
from app.invitations import accept as accept_invitation
from app.models import Invitation, Membership, Organization, Role, Session, User
from app.security import hash_password, hash_token, new_token, verify_password
from app.slugs import insert_with_unique_slug
from app.text import normalize_email

SESSION_COOKIE = "flowline_session"
SESSION_TTL = timedelta(days=30)

# Посчитан один раз при импорте модуля, а не на каждый запрос: используется в
# ветке authenticate(), где пользователь не найден, чтобы эта ветка стоила
# столько же по времени, сколько ветка с неверным паролем существующего
# пользователя. Без этого разница во времени ответа /api/auth/login выдаёт
# перебором, какие адреса зарегистрированы.
_DUMMY_PASSWORD_HASH = hash_password("timing-safety-dummy-password")


def _org_slug_taken(db: DbSession, slug: str) -> bool:
    return db.scalar(select(Organization.id).where(Organization.slug == slug)) is not None


def register(
    db: DbSession,
    *,
    name: str,
    email: str,
    password: str,
    locale: str | None = None,
    invitation: Invitation | None = None,
) -> User:
    """Заводит аккаунт. С приглашением на руках — сразу внутрь позвавшей
    организации, без него — со своей собственной.

    Пришедший по ссылке своей организации не получает. Она была бы пустышкой
    с ним одним внутри, а в закрытой установке (`SIGNUP_MODE=invite_only`)
    ещё и делала бы каждого приглашённого владельцем — пусть своей
    организации, но с правом звать в неё кого угодно, то есть в обход
    закрытости. Правило «при регистрации создаётся своя организация» описывает
    свободный вход с улицы; вход по приглашению — другая дверь.
    """
    normalized = normalize_email(email)
    if db.scalar(select(User).where(User.email == normalized)) is not None:
        raise ValueError("адрес уже занят")

    settings = get_settings()
    user = User(
        email=normalized,
        password_hash=hash_password(password),
        name=name.strip(),
        # Язык при первом появлении — из заголовка браузера, если тот просит
        # один из поддерживаемых. Дальше это значение меняет только человек:
        # заголовок больше не спрашивается никогда, иначе смена языка в
        # браузере молча переписывала бы сделанный выбор.
        locale=locale or settings.default_locale,
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

    if invitation is not None:
        accept_invitation(db, invitation, user=user, now=datetime.now(timezone.utc))
        return user

    org_name = name.strip()
    org = insert_with_unique_slug(
        db,
        lambda slug: Organization(name=org_name, slug=slug),
        name=org_name,
        is_taken=lambda slug: _org_slug_taken(db, slug),
        fallback="org",
    )

    db.add(Membership(org_id=org.id, user_id=user.id, role=Role.OWNER))
    db.flush()
    return user


def authenticate(db: DbSession, *, email: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.email == normalize_email(email)))
    if user is None:
        verify_password(password, _DUMMY_PASSWORD_HASH)
        return None
    return user if verify_password(password, user.password_hash) else None


def open_session(db: DbSession, user: User, *, active_org_id: uuid.UUID | None = None) -> str:
    raw, hashed = new_token()
    db.add(
        Session(
            user_id=user.id,
            token_hash=hashed,
            expires_at=datetime.now(timezone.utc) + SESSION_TTL,
            # Задаётся при входе по приглашению: человек только что вошёл в
            # чужую организацию и должен увидеть именно её, а не ту, что
            # оказалась первой по порядку.
            active_org_id=active_org_id,
        )
    )
    db.flush()
    return raw


def close_session(db: DbSession, raw_token: str) -> None:
    record = db.scalar(select(Session).where(Session.token_hash == hash_token(raw_token)))
    if record is not None:
        db.delete(record)


def session_for_token(db: DbSession, raw_token: str | None) -> Session | None:
    """Запись сессии по сырому токену куки. `None` — токена нет, он не
    находится или просрочен.

    Отдельно от current_session, потому что у WebSocket нет ни статуса ответа,
    ни заголовков: отказ там — это код закрытия сокета. Общая часть обязана
    быть одной функцией, иначе однажды разойдётся проверка срока годности, и
    просроченная сессия будет отбиваться в HTTP, но проходить в сокет.

    Отдаётся запись, а не только её владелец: на ней живёт выбранная
    организация, и сокету она нужна ровно затем же, зачем HTTP-маршрутам, —
    чтобы отвечать в той организации, которую человек выбрал.
    """
    if not raw_token:
        return None

    record = db.scalar(select(Session).where(Session.token_hash == hash_token(raw_token)))
    if record is None or record.expires_at < datetime.now(timezone.utc):
        return None

    return record


def user_for_token(db: DbSession, raw_token: str | None) -> User | None:
    record = session_for_token(db, raw_token)
    return None if record is None else db.get(User, record.user_id)


def current_session(
    flowline_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: DbSession = Depends(get_db),
) -> Session:
    """Запись сессии, а не только её владелец: на ней живёт выбранная
    организация, и переключателю нужна сама запись, чтобы её переписать."""
    # Отсутствие куки и негодная кука — разные коды: первое значит «войди»,
    # второе — «войди заново», и человеку это разные сообщения.
    if not flowline_session:
        raise HTTPException(status_code=401, detail="not_authenticated")

    record = session_for_token(db, flowline_session)
    if record is None:
        raise HTTPException(status_code=401, detail="session_expired")

    return record


def current_user(
    flowline_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: DbSession = Depends(get_db),
) -> User:
    return db.get(User, current_session(flowline_session, db).user_id)
