"""Подтверждение адреса почты: выдача ссылки и её погашение.

Подтверждение ничего не запрещает. Оно отвечает на один вопрос — доходят ли
письма до этого человека, — и потому не стоит на пути входа: установка без
почтового сервера обязана оставаться полноценной, а там `email_verified_at`
остаётся пустым у всех (§3 спецификации). Как только подтверждение начнёт
что-то блокировать, такая установка перестанет работать целиком.

Токен хранится хешем и срабатывает один раз — так же, как токен сессии в
app.auth: одна и та же дисциплина на все секреты, которые уходят наружу.
Погашенная строка при этом не удаляется, а помечается: по ссылке из письма
ходят дважды, и второму заходу отвечают «адрес уже подтверждён», а не
«ссылка не подходит».
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import NamedTuple
from urllib.parse import urlencode

from sqlalchemy import delete, func, select, update
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


class Confirmation(NamedTuple):
    """Итог погашения ссылки.

    `already_verified` — ссылку открыли не в первый раз. Это не отказ:
    адрес подтверждён, делать человеку нечего, и говорить ему про
    недействительную ссылку значило бы пугать успехом.
    """

    user: User
    already_verified: bool


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

    Отметка об отправке ставится после письма, а не вместе с токеном: от неё
    считается пауза до следующего письма, и выданный токен паузу не заводит.
    Иначе недоступный почтовый сервер запирал бы кнопку «отправить ещё раз»
    на минуту за письмо, которого никто не отправлял.
    """
    link = verification_link(issue_token(db, user))
    sent = mail.send(
        to=user.email,
        template="verify_email",
        locale=user.locale,
        params={
            "name": user.name,
            "link": link,
            "hours": int(VERIFICATION_TTL.total_seconds() // 3600),
        },
    )
    if sent:
        note_sent(db, user)
    return sent


def note_sent(db: DbSession, user: User) -> None:
    """Отмечает: письмо ушло. С этой минуты считается пауза до следующего.

    Обновляет строки владельца, а не одну конкретную: годная у него ровно
    одна — issue_token сносит прежние перед выдачей новой.
    """
    db.execute(
        update(EmailVerification)
        .where(EmailVerification.user_id == user.id)
        .values(sent_at=datetime.now(timezone.utc))
    )
    db.flush()


def sent_recently(db: DbSession, user: User) -> bool:
    """Ушло ли письмо этому человеку только что.

    Считается от отправки, а не от выдачи токена: письмо, застрявшее в
    недоступном почтовом сервере, паузу не заводит — иначе первое же нажатие
    кнопки получало бы отказ за письмо, которого не было.
    """
    latest = db.scalar(
        select(func.max(EmailVerification.sent_at)).where(
            EmailVerification.user_id == user.id
        )
    )
    return latest is not None and latest > datetime.now(timezone.utc) - RESEND_COOLDOWN


def confirm_email(db: DbSession, raw_token: str) -> Confirmation:
    """Гасит ссылку и ставит отметку о подтверждении.

    Погашенная ссылка остаётся в таблице до конца своего срока и на повторное
    открытие отвечает «адрес уже подтверждён»: по ссылке из письма ходят
    дважды — сначала почтовый сканер или предпросмотр, потом человек, — и
    удалённая строка отвечала бы ему «ссылка не подходит».
    """
    record = db.scalar(
        select(EmailVerification).where(EmailVerification.token_hash == hash_token(raw_token))
    )
    if record is None:
        raise VerificationError("invalid_token")

    user = db.get(User, record.user_id)

    # Отметка о погашении проверяется раньше срока годности: ссылкой, которая
    # уже сработала, ничего не подтверждают второй раз, а человеку с
    # подтверждённым адресом незачем читать про истёкший срок.
    if record.used_at is not None:
        return Confirmation(user, already_verified=True)

    if record.expires_at < datetime.now(timezone.utc):
        # Просроченную строку убираем сразу: она уже ни на что не годна, а
        # оставленная — накапливается и мешает читать таблицу.
        db.delete(record)
        db.flush()
        raise VerificationError("token_expired")

    now = datetime.now(timezone.utc)
    user.email_verified_at = now
    record.used_at = now
    # Прочие ссылки владельца гасятся насовсем: отвечать «уже подтверждён»
    # должна та, по которой пришли, а не любая из выданных когда-то.
    db.execute(
        delete(EmailVerification).where(
            EmailVerification.user_id == user.id, EmailVerification.id != record.id
        )
    )
    # Заодно подметаются просроченные строки всех остальных: у погашенной
    # ссылки нет второго повода зайти в эту таблицу, и без уборки здесь
    # подтверждённые адреса оставляли бы в ней по строке навсегда.
    db.execute(delete(EmailVerification).where(EmailVerification.expires_at < now))
    db.flush()
    return Confirmation(user, already_verified=False)
