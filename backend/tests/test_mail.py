"""Почта: письмо-приглашение и три транспорта за одним интерфейсом.

Проверяется и то, что в письме есть, и то, чего в нём быть не должно: оно
уходит на адрес, который никто ещё не подтверждал, и всё, что попадёт в его
текст, попадёт неизвестно кому.
"""

import logging
import smtplib
from datetime import datetime, timezone

import pytest

from app.config import get_settings
from app.mail import MailError, Letter, invitation_letter, mail_enabled, send

EXPIRES = datetime(2026, 8, 18, 9, 30, tzinfo=timezone.utc)


def _letter(locale: str = "ru") -> Letter:
    return invitation_letter(
        to="guest@example.com",
        locale=locale,
        org_name="Acme",
        inviter_name="Мария",
        role="editor",
        url="https://flowline.example.com/invite/abc",
        expires_at=EXPIRES,
    )


@pytest.fixture
def settings_env(monkeypatch):
    """Переменные окружения с очисткой кэша настроек до и после теста."""

    def _set(**env: str):
        for name, value in env.items():
            monkeypatch.setenv(name, value)
        get_settings.cache_clear()

    get_settings.cache_clear()
    try:
        yield _set
    finally:
        get_settings.cache_clear()


def test_the_letter_says_who_invites_where_and_until_when():
    letter = _letter()

    assert letter.to == "guest@example.com"
    assert "Acme" in letter.subject
    assert "Мария" in letter.body
    assert "редактор" in letter.body
    assert "https://flowline.example.com/invite/abc" in letter.body
    assert "2026-08-18" in letter.body


def test_the_letter_speaks_the_language_of_the_organization():
    assert "invites you" in _letter("en").body
    assert "dəvət edir" in _letter("az").body


def test_an_unknown_language_falls_back_instead_of_failing():
    """Язык организации — колонка в базе; попавшее в неё незнакомое значение
    не должно превращать единственное письмо приложения в исключение."""
    letter = _letter("kl")
    assert "https://flowline.example.com/invite/abc" in letter.body


def test_the_transport_switch_decides_whether_mail_exists_at_all(settings_env):
    settings_env(MAIL_TRANSPORT="none")
    assert mail_enabled() is False

    settings_env(MAIL_TRANSPORT="log")
    assert mail_enabled() is True


def test_sending_with_mail_turned_off_is_an_error_not_a_silent_success(settings_env):
    settings_env(MAIL_TRANSPORT="none")
    with pytest.raises(MailError) as error:
        send(_letter())
    assert error.value.code == "mail_disabled"


def test_the_log_transport_writes_the_letter_instead_of_sending_it(settings_env, caplog):
    settings_env(MAIL_TRANSPORT="log")
    with caplog.at_level(logging.INFO, logger="app.mail"):
        send(_letter())
    assert "guest@example.com" in caplog.text


def test_smtp_without_a_server_address_names_the_setting(settings_env):
    settings_env(MAIL_TRANSPORT="smtp", SMTP_URL="", MAIL_FROM="flowline@example.com")
    with pytest.raises(MailError) as error:
        send(_letter())
    # Ошибка настройки, а не сбой доставки: иначе её будут искать в чужом
    # почтовом сервере.
    assert error.value.code == "mail_not_configured"


def test_smtp_without_a_sender_address_names_the_setting_too(settings_env):
    settings_env(MAIL_TRANSPORT="smtp", SMTP_URL="smtp://mail.example.com", MAIL_FROM="")
    with pytest.raises(MailError) as error:
        send(_letter())
    assert error.value.code == "mail_not_configured"


class _FakeSMTP:
    """Минимальный SMTP-сервер, записывающий то, что с ним делали."""

    calls: dict = {}

    def __init__(self, host, port, timeout=None):
        _FakeSMTP.calls = {"host": host, "port": port, "timeout": timeout, "steps": []}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def ehlo(self):
        _FakeSMTP.calls["steps"].append("ehlo")

    def has_extn(self, name):
        return name == "starttls"

    def starttls(self, context=None):
        _FakeSMTP.calls["steps"].append("starttls")

    def login(self, user, password):
        _FakeSMTP.calls["credentials"] = (user, password)

    def send_message(self, message):
        _FakeSMTP.calls["message"] = message


def test_smtp_closes_the_channel_before_handing_over_the_password(settings_env, monkeypatch):
    settings_env(
        MAIL_TRANSPORT="smtp",
        SMTP_URL="smtp://robot:se%40cret@mail.example.com:2525",
        MAIL_FROM="flowline@example.com",
    )
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)

    send(_letter())

    calls = _FakeSMTP.calls
    assert (calls["host"], calls["port"]) == ("mail.example.com", 2525)
    assert calls["steps"].index("starttls") < len(calls["steps"])
    # Пароль со спецсимволом приезжает раскодированным, а не как %40.
    assert calls["credentials"] == ("robot", "se@cret")
    assert calls["message"]["From"] == "flowline@example.com"
    assert calls["message"]["To"] == "guest@example.com"


def test_a_server_that_refuses_gives_a_mail_error_not_a_smtp_exception(settings_env, monkeypatch):
    settings_env(
        MAIL_TRANSPORT="smtp",
        SMTP_URL="smtp://mail.example.com",
        MAIL_FROM="flowline@example.com",
    )

    def refuse(*args, **kwargs):
        raise smtplib.SMTPConnectError(421, "нет")

    monkeypatch.setattr(smtplib, "SMTP", refuse)

    with pytest.raises(MailError) as error:
        send(_letter())
    assert error.value.code == "mail_failed"


def test_a_network_that_is_not_there_gives_a_mail_error_too(settings_env, monkeypatch):
    """OSError — не SMTPException, и без отдельной ветки он долетал бы до
    клиента пятисоткой вместо честного «письмо не ушло»."""
    settings_env(
        MAIL_TRANSPORT="smtp",
        SMTP_URL="smtp://mail.example.com",
        MAIL_FROM="flowline@example.com",
    )

    def unreachable(*args, **kwargs):
        raise OSError("нет маршрута до узла")

    monkeypatch.setattr(smtplib, "SMTP", unreachable)

    with pytest.raises(MailError):
        send(_letter())
