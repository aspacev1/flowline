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

SESSION_COOKIE = "planora_session"
SESSION_TTL = timedelta(days=30)

# Сессия, которой не пользуются, умирает раньше своего срока годности:
# украденная кука с брошенного устройства не должна жить месяц только
# потому, что её однажды выдали. Простой — с последнего обращения.
SESSION_IDLE_TTL = timedelta(days=7)

# Отметка «пользовались» пишется не чаще этого шага: иначе каждое чтение
# проекта — это ещё и UPDATE по таблице сессий. Для таймаута в дни точность
# в четверть часа — более чем.
_LAST_USED_WRITE_STEP = timedelta(minutes=15)

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
    company_name: str | None = None,
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

    `company_name` называет эту новую организацию. HTTP-маршрут требует его
    всегда, когда организация действительно заводится (см. auth_routes.py,
    company_name_required), а здесь параметр остаётся необязательным: этой
    функцией пользуются и вызовы рангом ниже маршрута — например, тесты,
    которым имя организации безразлично, — и без компании они по-прежнему
    получают организацию, названную именем самого человека.
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

    org_name = (company_name or name).strip()
    # Язык организации — язык её основателя, а не значение по умолчанию из
    # модели. На этом языке уходят письма организации, и прежде всего
    # приглашения: их язык брался из `organizations.default_locale`, куда при
    # регистрации никто ничего не клал, — и русскоязычный владелец рассылал
    # команде приглашения по-азербайджански, не имея способа заметить это из
    # интерфейса. Язык человека в этот момент уже известен и лежит в профиле.
    org = insert_with_unique_slug(
        db,
        lambda slug: Organization(name=org_name, slug=slug, default_locale=user.locale),
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
    now = datetime.now(timezone.utc)
    # Попутная уборка: просроченные сессии этого человека никому больше не
    # нужны, а другого регулярного места, где их подметать, у архитектуры без
    # планировщика нет. Вход — естественный момент: он и так пишет в таблицу.
    db.execute(
        Session.__table__.delete().where(
            Session.user_id == user.id,
            Session.expires_at < now,
        )
    )
    # Вход и регистрация — тоже активность. Без этой строки свежий аккаунт
    # показывал бы панели директора «не заходил» весь первый шаг обновления
    # (см. _LAST_USED_WRITE_STEP) — до первого чтения, случившегося позже,
    # чем через четверть часа после входа.
    user.last_active_at = now
    raw, hashed = new_token()
    db.add(
        Session(
            user_id=user.id,
            token_hash=hashed,
            expires_at=now + SESSION_TTL,
            # Задаётся при входе по приглашению: человек только что вошёл в
            # чужую организацию и должен увидеть именно её, а не ту, что
            # оказалась первой по порядку.
            active_org_id=active_org_id,
        )
    )
    db.flush()
    return raw


def close_other_sessions(db: DbSession, user: User, *, keep_raw_token: str | None) -> int:
    """«Выйти на всех устройствах»: закрывает все сессии, кроме текущей.

    Текущая остаётся: человек, нажавший кнопку после смены пароля, не должен
    вылететь сам — иначе кнопка выглядит как поломка.
    """
    query = Session.__table__.delete().where(Session.user_id == user.id)
    if keep_raw_token:
        query = query.where(Session.token_hash != hash_token(keep_raw_token))
    result = db.execute(query)
    return result.rowcount or 0


def change_password(db: DbSession, user: User, *, current: str, new: str) -> None:
    """Смена пароля с проверкой прежнего.

    Прежний пароль обязателен: смена пароля — это ровно то действие, которое
    делает украденную сессию бесполезной, и выполняться по одной лишь сессии
    оно не должно. ValueError — неверный прежний пароль.
    """
    if not verify_password(current, user.password_hash):
        raise ValueError("прежний пароль не подошёл")
    user.password_hash = hash_password(new)
    db.flush()


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
    now = datetime.now(timezone.utc)
    if record is None or record.expires_at < now:
        return None

    # Idle-таймаут: сессией не пользовались дольше SESSION_IDLE_TTL — она
    # мертва, каким бы ни был её формальный срок годности.
    if record.last_used_at is not None and now - record.last_used_at > SESSION_IDLE_TTL:
        db.delete(record)
        db.flush()
        return None

    # Отметка «пользовались» — с шагом, а не на каждый запрос (см. константу).
    if record.last_used_at is None or now - record.last_used_at > _LAST_USED_WRITE_STEP:
        record.last_used_at = now
        # Тем же шагом обновляется последняя активность самого человека — она
        # переживает уборку строк сессии (см. комментарий у User.last_active_at
        # в models.py) и кормит панель директора.
        user = db.get(User, record.user_id)
        if user is not None:
            user.last_active_at = now
        db.flush()

    return record


def user_for_token(db: DbSession, raw_token: str | None) -> User | None:
    record = session_for_token(db, raw_token)
    return None if record is None else db.get(User, record.user_id)


def current_session(
    planora_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: DbSession = Depends(get_db),
) -> Session:
    """Запись сессии, а не только её владелец: на ней живёт выбранная
    организация, и переключателю нужна сама запись, чтобы её переписать."""
    # Отсутствие куки и негодная кука — разные коды: первое значит «войди»,
    # второе — «войди заново», и человеку это разные сообщения.
    if not planora_session:
        raise HTTPException(status_code=401, detail="not_authenticated")

    record = session_for_token(db, planora_session)
    if record is None:
        raise HTTPException(status_code=401, detail="session_expired")

    return record


def current_user(
    planora_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: DbSession = Depends(get_db),
) -> User:
    return db.get(User, current_session(planora_session, db).user_id)
