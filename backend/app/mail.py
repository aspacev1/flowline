"""Почта: тонкий интерфейс и три реализации за ним.

Письмо во всём приложении ровно одно — приглашение. Оно уходит синхронно, в
том же запросе: очереди в первой версии нет, а заводить её ради одного письма
значит добавить фоновый процесс, повторные попытки и наблюдение за ними — и
всё это до того, как хоть кто-то отправит второе письмо.

Отсюда же правило вокруг: неудачная отправка не откатывает приглашение.
Приглашение существует независимо от того, доставили его письмом или нет, и
ссылку всегда можно скопировать руками.
"""

import logging
import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
from urllib.parse import unquote, urlsplit

from app.config import get_settings

logger = logging.getLogger("app.mail")

# Письмо уходит внутри запроса пользователя: сервер, который не отвечает,
# обязан отпустить запрос, а не держать его до таймаута сокета по умолчанию.
SMTP_TIMEOUT = 10


class MailError(Exception):
    """Письмо не ушло. `code` — машинный, переводится на клиенте."""

    def __init__(self, code: str = "mail_failed") -> None:
        super().__init__(code)
        self.code = code


def mail_enabled() -> bool:
    """Настроена ли в установке почта.

    От этого зависит не только отправка: при `none` интерфейс не показывает
    кнопку отправки вовсе, оставляя только копирование ссылки. Установка без
    почтового сервера должна оставаться полноценной, а не показывать кнопку,
    которая всегда отвечает отказом.
    """
    return get_settings().mail_transport != "none"


@dataclass(frozen=True)
class Letter:
    to: str
    subject: str
    body: str


# Единственные человеческие тексты на сервере — и исключение здесь
# вынужденное: письмо читают в почтовом клиенте, где перевести машинный код
# некому. Язык письма — язык организации: о языке получателя, который ещё
# ничего в этой установке не открывал, неизвестно вообще ничего.
_ROLE_NAMES: dict[str, dict[str, str]] = {
    "az": {"owner": "sahib", "editor": "redaktor", "viewer": "izləyici", "client": "müştəri"},
    "en": {"owner": "owner", "editor": "editor", "viewer": "viewer", "client": "client"},
    "ru": {"owner": "владелец", "editor": "редактор", "viewer": "наблюдатель", "client": "клиент"},
}

_TEMPLATES: dict[str, dict[str, str]] = {
    "az": {
        "subject": "{org} təşkilatına dəvət",
        "body": (
            "{inviter} sizi Flowline-da «{org}» təşkilatına dəvət edir.\n"
            "Rolunuz: {role}.\n\n"
            "Qoşulmaq üçün keçid:\n{url}\n\n"
            "Keçid {expires} tarixinədək etibarlıdır.\n"
        ),
    },
    "en": {
        "subject": "Invitation to {org}",
        "body": (
            "{inviter} invites you to the organization “{org}” on Flowline.\n"
            "Your role: {role}.\n\n"
            "Join using this link:\n{url}\n\n"
            "The link is valid until {expires}.\n"
        ),
    },
    "ru": {
        "subject": "Приглашение в организацию {org}",
        "body": (
            "{inviter} приглашает вас в организацию «{org}» во Flowline.\n"
            "Ваша роль: {role}.\n\n"
            "Ссылка для входа:\n{url}\n\n"
            "Ссылка действует до {expires}.\n"
        ),
    },
}

_FALLBACK_LOCALE = "az"


def invitation_letter(
    *,
    to: str,
    locale: str,
    org_name: str,
    inviter_name: str,
    role: str,
    url: str,
    expires_at: datetime,
) -> Letter:
    """Письмо-приглашение. Ни названий проектов, ни задач в нём нет.

    Содержимое — минимум: кто зовёт, куда, кем, ссылка и до какого числа она
    живёт. Письмо уходит на адрес, который никто ещё не подтверждал, и всё,
    что попадёт в его текст, попадёт неизвестно кому.
    """
    template = _TEMPLATES.get(locale, _TEMPLATES[_FALLBACK_LOCALE])
    names = _ROLE_NAMES.get(locale, _ROLE_NAMES[_FALLBACK_LOCALE])
    params = {
        "org": org_name,
        "inviter": inviter_name,
        "role": names.get(role, role),
        "url": url,
        # Дата, а не дата со временем: час и минуты в чужом часовом поясе
        # ничего читателю не говорят, а ISO-форма читается на всех трёх языках
        # одинаково.
        "expires": expires_at.date().isoformat(),
    }
    return Letter(
        to=to,
        subject=template["subject"].format(**params),
        body=template["body"].format(**params),
    )


def send(letter: Letter) -> None:
    """Отправляет письмо выбранным транспортом.

    Любая неудача — `MailError`, а не исключение транспорта: вызывающий обязан
    пережить её, не разбираясь, что именно ответил чужой сервер.
    """
    transport = get_settings().mail_transport
    if transport == "none":
        raise MailError("mail_disabled")
    if transport == "log":
        logger.info(
            "письмо (транспорт log, не отправлено): to=%s subject=%s\n%s",
            letter.to,
            letter.subject,
            letter.body,
        )
        return
    _send_over_smtp(letter)


def _message(letter: Letter, sender: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = sender
    message["To"] = letter.to
    message["Subject"] = letter.subject
    message.set_content(letter.body)
    return message


def _send_over_smtp(letter: Letter) -> None:
    settings = get_settings()
    url = urlsplit(settings.smtp_url)
    if not url.hostname or not settings.mail_from:
        # Разворачивавший выбрал транспорт smtp, но не дал адреса сервера или
        # отправителя. Это ошибка настройки, а не сбой доставки, и называется
        # она отдельно — иначе её будут искать в чужом почтовом сервере.
        raise MailError("mail_not_configured")

    secure = url.scheme == "smtps"
    port = url.port or (465 if secure else 587)
    connect = smtplib.SMTP_SSL if secure else smtplib.SMTP

    try:
        with connect(url.hostname, port, timeout=SMTP_TIMEOUT) as server:
            server.ehlo()
            if not secure and server.has_extn("starttls"):
                # Учётные данные и адрес получателя не уходят по открытому
                # каналу, если сервер умеет его закрыть.
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            if url.username:
                server.login(unquote(url.username), unquote(url.password or ""))
            server.send_message(_message(letter, settings.mail_from))
    except (smtplib.SMTPException, OSError) as error:
        # Адрес сервера и учётные данные в текст ошибки не попадают: он
        # доезжает до журнала, а журнал читают не только те, кому положено
        # знать пароль от почты.
        logger.warning("письмо не ушло: %s", type(error).__name__)
        raise MailError() from error
