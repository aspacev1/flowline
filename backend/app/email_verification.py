"""Подтверждение адреса почты: выдача ссылки и её погашение.

Подтверждение ничего не запрещает. Оно отвечает на один вопрос — доходят ли
письма до этого человека, — и потому не стоит на пути входа: установка без
почтового сервера обязана оставаться полноценной, а там `email_verified_at`
остаётся пустым у всех (§3 спецификации). Как только подтверждение начнёт
что-то блокировать, такая установка перестанет работать целиком.

Токен хранится хешем и гасится при первом использовании — так же, как
токен сессии в app.auth: одна и та же дисциплина на все секреты, которые
уходят наружу.
"""

import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DbSession

from app import mail
from app.config import get_settings
from app.models import EmailVerification, User
from app.security import hash_token, new_token

logger = logging.getLogger(__name__)

# Сутки: письмо читают вечером того же дня или следующим утром, а ссылка,
# живущая неделю, всё это время лежит в почтовом ящике готовым ключом.
VERIFICATION_TTL = timedelta(hours=24)

# Пауза между повторными отправками. Кнопка «отправить ещё раз» — это
# отправитель писем на любой адрес, введённый при регистрации, и без
# паузы одна учётная запись превращает приложение в бесплатный рассыльщик
# по чужому ящику.
RESEND_COOLDOWN = timedelta(minutes=1)


class VerificationError(Exception):
    """Ссылку не приняли. `code` уходит наружу как есть, без прозы."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def issue_token(db: DbSession, user: User) -> str:
    """Новый токен подтверждения. Прежние гасит: действует последняя ссылка.

    Иначе каждая повторная отправка оставляла бы за собой ещё один рабочий
    ключ, и «ссылка перестала работать» после повторной отправки стало бы
    неправдой при разборе инцидента.
    """
    db.execute(delete(EmailVerification).where(EmailVerification.user_id == user.id))
    raw, hashed = new_token()
    db.add(
        EmailVerification(
            user_id=user.id,
            token_hash=hashed,
            expires_at=datetime.now(timezone.utc) + VERIFICATION_TTL,
        )
    )
    db.flush()
    return raw


def verification_link(raw_token: str) -> str:
    base = get_settings().public_base_url.rstrip("/")
    return f"{base}/verify-email?{urlencode({'token': raw_token})}"


def send_verification(db: DbSession, user: User) -> bool:
    """Выдаёт ссылку и отправляет письмо. False — письмо не ушло.

    Токен выдаётся до отправки и остаётся выданным, даже если письмо не
    ушло: адрес почты владельцу учётной записи известен, повторная отправка
    доступна, а откат токена ничего бы не улучшил.
    """
    link = verification_link(issue_token(db, user))
    return mail.send(
        to=user.email,
        template="verify_email",
        locale=user.locale,
        params={
            "name": user.name,
            "link": link,
            "hours": int(VERIFICATION_TTL.total_seconds() // 3600),
        },
    )


def sent_recently(db: DbSession, user: User) -> bool:
    latest = db.scalar(
        select(func.max(EmailVerification.created_at)).where(
            EmailVerification.user_id == user.id
        )
    )
    return latest is not None and latest > datetime.now(timezone.utc) - RESEND_COOLDOWN


def confirm_email(db: DbSession, raw_token: str) -> User:
    """Гасит ссылку и ставит отметку о подтверждении."""
    record = db.scalar(
        select(EmailVerification).where(EmailVerification.token_hash == hash_token(raw_token))
    )
    if record is None:
        raise VerificationError("invalid_token")

    if record.expires_at < datetime.now(timezone.utc):
        # Просроченную строку убираем сразу: она уже ни на что не годна, а
        # оставленная — накапливается и мешает читать таблицу.
        db.delete(record)
        db.flush()
        raise VerificationError("token_expired")

    user = db.get(User, record.user_id)
    user.email_verified_at = datetime.now(timezone.utc)
    db.execute(delete(EmailVerification).where(EmailVerification.user_id == user.id))
    db.flush()
    return user
