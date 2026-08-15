"""Восстановление пароля: выдача ссылки по почте и её погашение.

Почта здесь — не удобство, а единственное доказательство: человек без пароля
может подтвердить, что аккаунт его, только доступом к своему ящику. Поэтому
в установке без почтового сервера (MAIL_TRANSPORT=none) восстановление не
работает — и это честнее, чем делать вид, что письмо ушло.

Токен хранится хешем и гасится при первом использовании — та же дисциплина,
что у сессий и подтверждения адреса (app.email_verification). Отличие одно:
эта ссылка открывает аккаунт целиком, поэтому живёт часы, а не сутки, и её
погашение закрывает все сессии — восстановлением пользуются как раз тогда,
когда есть подозрение, что пароль утёк.
"""

import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DbSession

from app import mail
from app.config import get_settings
from app.models import PasswordReset, Session, User
from app.security import hash_password, hash_token, new_token

logger = logging.getLogger(__name__)

# Часы, а не сутки, как у подтверждения адреса: та ссылка лишь ставит отметку,
# эта — задаёт новый пароль. Ключ от аккаунта не должен неделю лежать в ящике,
# который, возможно, уже читает кто-то чужой.
RESET_TTL = timedelta(hours=2)

# Пауза между повторными просьбами. Форма восстановления принимает любой
# адрес, и без паузы она — бесплатный рассыльщик по чужому ящику (та же
# арифметика, что у повторной отправки подтверждения).
RESEND_COOLDOWN = timedelta(minutes=1)


class ResetError(Exception):
    """Ссылку не приняли. `code` уходит наружу как есть, без прозы."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def issue_token(db: DbSession, user: User) -> str:
    """Новый токен восстановления. Прежние гасит: действует последняя ссылка."""
    db.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    raw, hashed = new_token()
    db.add(
        PasswordReset(
            user_id=user.id,
            token_hash=hashed,
            expires_at=datetime.now(timezone.utc) + RESET_TTL,
        )
    )
    db.flush()
    return raw


def reset_link(raw_token: str) -> str:
    base = get_settings().public_base_url.rstrip("/")
    return f"{base}/reset-password?{urlencode({'token': raw_token})}"


def send_reset(db: DbSession, user: User) -> bool:
    """Выдаёт ссылку и отправляет письмо. False — письмо не ушло.

    Токен выдаётся до отправки и остаётся выданным, даже если письмо не
    ушло: повторная просьба выдаст новый и погасит этот, а откат ничего бы
    не улучшил.
    """
    link = reset_link(issue_token(db, user))
    return mail.send(
        to=user.email,
        template="reset_password",
        locale=user.locale,
        params={
            "name": user.name,
            "link": link,
            "hours": int(RESET_TTL.total_seconds() // 3600),
        },
    )


def sent_recently(db: DbSession, user: User) -> bool:
    latest = db.scalar(
        select(func.max(PasswordReset.created_at)).where(PasswordReset.user_id == user.id)
    )
    return latest is not None and latest > datetime.now(timezone.utc) - RESEND_COOLDOWN


def redeem_token(db: DbSession, raw_token: str, *, new_password: str) -> User:
    """Гасит ссылку, ставит новый пароль и закрывает все сессии владельца.

    Все, а не «кроме текущей»: у человека, забывшего пароль, сессии нет, а
    у того, кто восстановлением выгоняет угонщика, чужие сессии — ровно то,
    что должно умереть. Свою он откроет следующим входом.
    """
    record = db.scalar(
        select(PasswordReset).where(PasswordReset.token_hash == hash_token(raw_token))
    )
    if record is None:
        raise ResetError("invalid_token")

    if record.expires_at < datetime.now(timezone.utc):
        # Просроченную строку убираем сразу: она уже ни на что не годна.
        db.delete(record)
        db.flush()
        raise ResetError("token_expired")

    user = db.get(User, record.user_id)
    user.password_hash = hash_password(new_password)
    db.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    db.execute(delete(Session).where(Session.user_id == user.id))
    db.flush()
    return user
