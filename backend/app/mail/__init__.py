"""Почта за одним интерфейсом: send(to, template, params).

Тот же приём, что и с LLM: тонкий интерфейс и несколько реализаций.
Вызывающий код не знает, ушло письмо по SMTP, через API рассылочного
сервиса или в журнал — он называет шаблон и данные для подстановки.

Письма уходят синхронно, в том же запросе: очереди в первой версии нет, а
писем во всём приложении два-три. Неудачная отправка возвращает False и
пишет причину в журнал, но не поднимает исключение наверх — приглашение
или регистрация уже состоялись, и откатывать их из-за недоступного
почтового сервера было бы хуже, чем честно сказать «письмо не ушло».
"""

import logging
from collections.abc import Mapping

from app.config import Settings, get_settings
from app.mail.templates import render, term
from app.mail.transports import (
    ApiTransport,
    Letter,
    LogTransport,
    MailError,
    SmtpTransport,
    Transport,
)

logger = logging.getLogger(__name__)

__all__ = [
    "ApiTransport",
    "Letter",
    "LogTransport",
    "MailError",
    "SmtpTransport",
    "Transport",
    "build_transport",
    "mail_enabled",
    "role_name",
    "send",
]


def mail_enabled() -> bool:
    """Настроена ли в установке почта.

    От этого зависит не только отправка: при `none` интерфейс не показывает
    кнопку отправки вовсе, оставляя только копирование ссылки. Установка без
    почтового сервера должна оставаться полноценной, а не показывать кнопку,
    которая всегда отвечает отказом.
    """
    return get_settings().mail_enabled


def role_name(role: str, locale: str) -> str:
    """Название роли на языке письма. Незнакомая роль остаётся как есть."""
    try:
        return term("roles", role, locale)
    except MailError:
        return role


def build_transport(settings: Settings) -> Transport:
    """Транспорт по MAIL_TRANSPORT. Значение уже проверено в Settings."""
    if settings.mail_transport == "smtp":
        return SmtpTransport(settings.smtp_url, sender=settings.mail_from)
    if settings.mail_transport == "api":
        return ApiTransport(
            url=settings.mail_api_url,
            key=settings.mail_api_key,
            sender=settings.mail_from,
        )
    # log — режим разработки: журнал и есть почтовый ящик, токены видны.
    # none — боевой «почты нет»: текст письма в журнале, но токены замаскированы.
    return LogTransport(
        sender=settings.mail_from, reveal_secrets=settings.mail_transport == "log"
    )


def send(*, to: str, template: str, params: Mapping[str, object], locale: str) -> bool:
    """Отправляет письмо и говорит, дошло ли оно до почтового сервера.

    Транспорт создаётся на каждое письмо, а не один раз при старте: SMTP-
    соединение всё равно открывается под каждое письмо (их единицы), зато
    смена настроек не требует перезапуска чего-то ещё, кроме процесса, и в
    памяти не живёт сокет, который сервер давно закрыл со своей стороны.
    """
    settings = get_settings()
    try:
        letter = render(template, locale, params, to=to)
        build_transport(settings).deliver(letter)
    except MailError:
        # exception(), а не error(): причина отказа почти всегда в самом
        # низу цепочки (сокет, TLS, ответ сервиса), и без стека остаётся
        # гадать, какой именно из трёх транспортов и на чём споткнулся.
        logger.exception("письмо %r на %s не ушло", template, to)
        return False
    return True
