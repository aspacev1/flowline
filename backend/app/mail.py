"""Почта за тонким интерфейсом: `send(to, template, params)`.

Реализаций три — SMTP, API рассылочного сервиса и заглушка, пишущая письмо в
журнал. Основной вариант именно SMTP: он работает с любым провайдером, включая
собственный сервер, и не привязывает установку к платному сервису.

Письмо во всём приложении ровно одно — приглашение (плюс подтверждение
адреса там, где почта настроена), поэтому уходит оно синхронно, в том же
запросе: очереди в первой версии нет. Неудачная отправка не откатывает
действие — приглашение существует независимо от того, доставили его письмом
или нет, и интерфейс честно говорит «письмо не ушло, скопируйте ссылку».
"""

import json
import logging
import smtplib
import urllib.error
import urllib.request
from email.message import EmailMessage
from functools import lru_cache
from typing import Protocol
from urllib.parse import urlsplit

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


class MailError(Exception):
    """Письмо не ушло. Не отменяет действия, ради которого его отправляли."""


# Шаблоны писем. Ключ — (шаблон, язык); язык письма — язык организации, потому
# что о языке получателя пока ничего не известно.
#
# Письмо содержит минимум: кто пригласил, в какую организацию, какая роль,
# ссылка и срок её жизни. Ни названий проектов, ни задач: письмо уходит на
# адрес, который ещё никто не подтвердил.
TEMPLATES: dict[tuple[str, str], tuple[str, str]] = {
    ("invitation", "az"): (
        "{org} sizi Flowline-a dəvət edir",
        "{inviter} sizi «{org}» təşkilatına «{role}» rolu ilə dəvət edir.\n\n"
        "Keçid: {link}\nKeçid {days} gün ərzində etibarlıdır.",
    ),
    ("invitation", "en"): (
        "{org} invites you to Flowline",
        "{inviter} invites you to the “{org}” organization as {role}.\n\n"
        "Link: {link}\nThe link is valid for {days} days.",
    ),
    ("invitation", "ru"): (
        "{org} приглашает вас в Flowline",
        "{inviter} приглашает вас в организацию «{org}» с ролью «{role}».\n\n"
        "Ссылка: {link}\nСсылка действует {days} дней.",
    ),
    ("verify_email", "az"): (
        "Flowline: ünvanı təsdiqləyin",
        "Ünvanı təsdiqləmək üçün keçid: {link}",
    ),
    ("verify_email", "en"): (
        "Flowline: confirm your address",
        "Confirm your address here: {link}",
    ),
    ("verify_email", "ru"): (
        "Flowline: подтвердите адрес",
        "Подтвердите адрес по ссылке: {link}",
    ),
}


def render(template: str, locale: str, params: dict) -> tuple[str, str]:
    """Тема и тело письма на языке организации.

    Неизвестный язык падает на язык установки по умолчанию — по тому же
    правилу, что и словари интерфейса: отсутствие перевода не повод не
    отправить письмо вовсе.
    """
    key = (template, locale)
    if key not in TEMPLATES:
        key = (template, get_settings().default_locale)
    subject, body = TEMPLATES[key]
    return subject.format(**params), body.format(**params)


class Mailer(Protocol):
    #: Показывать ли кнопку «Отправить письмо». При выключенной почте остаётся
    #: только копирование ссылки — установка без почтового сервера должна
    #: оставаться полноценной.
    enabled: bool

    def send(self, to: str, template: str, locale: str, params: dict) -> None: ...


class DisabledMailer:
    """MAIL_TRANSPORT=none. Отправлять некуда, и делать вид, что ушло, нельзя."""

    enabled = False

    def send(self, to: str, template: str, locale: str, params: dict) -> None:
        raise MailError("почтовый транспорт выключен")


class LoggingMailer:
    """Письмо в журнал — для разработки и для установок, где почты ещё нет.

    Считается работающей отправкой сознательно: разработчик, поднявший
    приложение локально, обязан видеть текст письма, а не гадать, ушло оно
    или нет.
    """

    enabled = True

    def send(self, to: str, template: str, locale: str, params: dict) -> None:
        subject, body = render(template, locale, params)
        logger.info("письмо для %s: %s\n%s", to, subject, body)


class SmtpMailer:
    enabled = True

    def __init__(self, settings: Settings):
        self._url = urlsplit(settings.smtp_url)
        self._sender = settings.mail_from

    def send(self, to: str, template: str, locale: str, params: dict) -> None:
        subject, body = render(template, locale, params)
        message = EmailMessage()
        message["From"] = self._sender
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)

        port = self._url.port or (465 if self._url.scheme == "smtps" else 587)
        try:
            opener = smtplib.SMTP_SSL if self._url.scheme == "smtps" else smtplib.SMTP
            with opener(self._url.hostname or "localhost", port, timeout=10) as server:
                if self._url.scheme != "smtps":
                    # STARTTLS там, где сервер его предлагает. Молчаливая
                    # отправка учётных данных открытым текстом — не тот
                    # компромисс, который стоит делать по умолчанию.
                    try:
                        server.starttls()
                    except smtplib.SMTPNotSupportedError:
                        logger.warning("SMTP-сервер не предлагает STARTTLS")
                if self._url.username:
                    server.login(self._url.username, self._url.password or "")
                server.send_message(message)
        except (OSError, smtplib.SMTPException) as error:
            raise MailError(str(error)) from error


class ApiMailer:
    """Отправка через API рассылочного сервиса.

    urllib, а не сторонний клиент: ради одного POST в приложение не стоит
    тащить зависимость, которой больше нигде не найдётся применения.
    """

    enabled = True

    def __init__(self, settings: Settings):
        self._url = settings.mail_api_url
        self._key = settings.mail_api_key
        self._sender = settings.mail_from

    def send(self, to: str, template: str, locale: str, params: dict) -> None:
        subject, body = render(template, locale, params)
        payload = json.dumps(
            {"from": self._sender, "to": to, "subject": subject, "text": body}
        ).encode()
        request = urllib.request.Request(
            self._url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._key}",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                if response.status >= 400:
                    raise MailError(f"сервис ответил {response.status}")
        except (urllib.error.URLError, OSError) as error:
            raise MailError(str(error)) from error


def build_mailer(settings: Settings) -> Mailer:
    transport = settings.mail_transport
    if transport == "smtp":
        return SmtpMailer(settings)
    if transport == "api":
        return ApiMailer(settings)
    if transport == "log":
        return LoggingMailer()
    return DisabledMailer()


@lru_cache
def get_mailer() -> Mailer:
    return build_mailer(get_settings())
