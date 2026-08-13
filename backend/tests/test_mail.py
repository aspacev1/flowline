"""Почта: сборка текста, выбор транспорта и поведение каждого из трёх.

Ни один тест здесь не открывает сокет и не ходит в сеть: smtplib и urlopen
подменяются заглушками, которые записывают, что им передали. Проверяется не
«письмо дошло» (это работа почтового сервера), а то, что решает наш код —
язык письма, шифрование канала перед вводом пароля, форма запроса к API и
то, что отказ доставки не поднимается наверх исключением.
"""

import json
import logging
import smtplib
from urllib.error import HTTPError, URLError

import pytest

import app.mail as mail
from app.config import Settings
from app.mail.templates import available_locales, dictionary, render
from app.mail.transports import ApiTransport, Letter, LogTransport, MailError, SmtpTransport


def _settings(**env: str) -> Settings:
    return Settings(
        _env_file=None,
        app_secret="test-secret-not-for-production",
        database_url="postgresql+psycopg://u:p@host/db",
        **env,
    )


# ---- Текст письма -----------------------------------------------------------


def test_letter_comes_in_the_language_of_its_recipient():
    russian = render("verify_email", "ru", {"name": "Алекс", "link": "L", "hours": 24}, to="a@b.c")
    english = render("verify_email", "en", {"name": "Alex", "link": "L", "hours": 24}, to="a@b.c")

    assert "подтвердите" in russian.subject.lower()
    assert "confirm" in english.subject.lower()
    assert "Алекс" in russian.body and "L" in russian.body


def test_an_unknown_language_falls_back_instead_of_sending_an_empty_letter(caplog):
    with caplog.at_level(logging.WARNING):
        letter = render("verify_email", "fr", {"name": "Alex", "link": "L", "hours": 24}, to="a@b.c")

    assert letter.subject == dictionary("az")["verify_email"]["subject"]
    assert "fr" in caplog.text


def test_an_unknown_template_is_an_error_and_not_a_blank_page():
    with pytest.raises(MailError):
        render("welcome_aboard", "az", {}, to="a@b.c")


def test_every_language_has_every_template():
    """Полнота словарей проверяется здесь, а не глазами: рассинхрон копится
    незаметно и обнаруживается уже отправленным письмом (§9)."""
    locales = available_locales()
    assert set(locales) >= {"az", "en", "ru"}

    reference = {
        (template, field)
        for template, fields in dictionary("az").items()
        for field in fields
    }
    for locale in locales:
        keys = {
            (template, field)
            for template, fields in dictionary(locale).items()
            for field in fields
        }
        assert keys == reference, f"словарь писем {locale} разошёлся с az"


def test_missing_substitution_data_does_not_reach_the_recipient():
    with pytest.raises(MailError):
        render("verify_email", "en", {"name": "Alex"}, to="a@b.c")


def test_user_content_cannot_smuggle_a_placeholder_into_the_letter():
    # Подстановка идёт по шаблону: «{link}» в имени остаётся текстом.
    letter = render(
        "verify_email", "en", {"name": "{link}", "link": "https://x/y", "hours": 24}, to="a@b.c"
    )
    assert "Hello, {link}!" in letter.body


# ---- Выбор транспорта -------------------------------------------------------


@pytest.mark.parametrize(
    ("env", "expected"),
    [
        ({}, LogTransport),
        ({"mail_transport": "none"}, LogTransport),
        ({"mail_transport": "log"}, LogTransport),
        (
            {"mail_transport": "smtp", "smtp_url": "smtp://mail.example.com", "mail_from": "a@b.c"},
            SmtpTransport,
        ),
        (
            {
                "mail_transport": "api",
                "mail_api_url": "https://api.example.com/send",
                "mail_api_key": "k",
                "mail_from": "a@b.c",
            },
            ApiTransport,
        ),
    ],
)
def test_transport_follows_the_setting(env: dict, expected: type):
    assert isinstance(mail.build_transport(_settings(**env)), expected)


@pytest.mark.parametrize(
    "env",
    [
        {"mail_transport": "stmp"},  # опечатка не должна означать «почта выключена»
        {"mail_transport": "smtp"},  # без SMTP_URL и MAIL_FROM
        {"mail_transport": "smtp", "smtp_url": "smtp://mail.example.com"},  # без MAIL_FROM
        {"mail_transport": "api", "mail_api_url": "https://x/y", "mail_from": "a@b.c"},  # без ключа
    ],
)
def test_a_half_configured_mail_setup_refuses_to_start(env: dict):
    with pytest.raises(ValueError):
        _settings(**env)


def test_disabled_mail_is_a_legitimate_setup():
    settings = _settings()
    assert settings.mail_enabled is False
    assert _settings(
        mail_transport="smtp", smtp_url="smtp://mail.example.com", mail_from="a@b.c"
    ).mail_enabled is True


def test_the_log_transport_still_counts_as_a_mail_installation():
    """`none` и `log` пишут письмо в одно и то же место, но различаются тем,
    показывает ли интерфейс кнопку отправки: при разработке она нужна."""
    assert _settings(mail_transport="log").mail_enabled is True


# ---- Заглушка ---------------------------------------------------------------


def test_the_stub_writes_the_whole_letter_into_the_log(caplog):
    with caplog.at_level(logging.INFO):
        LogTransport(sender="Flowline <no-reply@example.com>").deliver(
            Letter(to="alex@example.com", subject="Тема", body="https://example.com/verify?token=x")
        )

    # Без текста письма установка без почтового сервера теряет единственный
    # способ достать ссылку.
    assert "https://example.com/verify?token=x" in caplog.text
    assert "alex@example.com" in caplog.text


# ---- SMTP -------------------------------------------------------------------


class FakeSMTP:
    """Заглушка smtplib.SMTP: записывает, что с ней делали."""

    instances: list["FakeSMTP"] = []
    advertise_starttls = True

    def __init__(self, host, port, timeout=None):
        self.host, self.port, self.timeout = host, port, timeout
        self.starttls_called = False
        self.login_args = None
        self.messages = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def ehlo(self):
        return 250, b"ok"

    def has_extn(self, name):
        return name == "starttls" and self.advertise_starttls

    def starttls(self):
        self.starttls_called = True

    def login(self, user, password):
        self.login_args = (user, password)

    def send_message(self, message):
        self.messages.append(message)


@pytest.fixture
def fake_smtp(monkeypatch):
    FakeSMTP.instances = []
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTP)
    return FakeSMTP


def _letter() -> Letter:
    return Letter(to="alex@example.com", subject="Тема", body="Текст")


def test_smtp_url_carries_host_credentials_and_port(fake_smtp):
    SmtpTransport(
        "smtp://user%40example.com:pa%2Fss@mail.example.com:2525", sender="a@b.c"
    ).deliver(_letter())

    smtp = fake_smtp.instances[0]
    assert (smtp.host, smtp.port) == ("mail.example.com", 2525)
    # Пароль со слэшем разбирается, а не рвёт адрес пополам.
    assert smtp.login_args == ("user@example.com", "pa/ss")
    assert smtp.starttls_called is True


@pytest.mark.parametrize(
    ("url", "expected_port"),
    [("smtp://mail.example.com", 587), ("smtps://mail.example.com", 465)],
)
def test_the_scheme_decides_the_default_port(fake_smtp, url: str, expected_port: int):
    SmtpTransport(url, sender="a@b.c").deliver(_letter())
    assert fake_smtp.instances[0].port == expected_port


def test_a_password_is_never_sent_over_a_plaintext_connection(fake_smtp, monkeypatch):
    monkeypatch.setattr(fake_smtp, "advertise_starttls", False)

    with pytest.raises(MailError, match="незашифрованному"):
        SmtpTransport("smtp://user:secret@mail.example.com", sender="a@b.c").deliver(_letter())

    assert fake_smtp.instances[-1].login_args is None
    assert fake_smtp.instances[-1].messages == []

    # Тот же сервер без учётных данных остаётся рабочим: локальному релею
    # (mailhog, postfix на той же машине) пароль не нужен, и запрещать
    # такую отправку было бы запретом на разработку без TLS.
    SmtpTransport("smtp://mail.example.com", sender="a@b.c").deliver(_letter())
    assert fake_smtp.instances[-1].messages


def test_a_letter_carries_date_and_a_message_id_from_the_sender_domain(fake_smtp):
    SmtpTransport("smtps://mail.example.com", sender="Flowline <no-reply@flowline.app>").deliver(
        _letter()
    )

    message = fake_smtp.instances[0].messages[0]
    assert message["Date"]
    # Не hostname контейнера: внутреннее имя машины не должно уезжать наружу.
    assert message["Message-ID"].endswith("@flowline.app>")
    assert message["To"] == "alex@example.com"
    assert message["Subject"] == "Тема"


def test_a_broken_smtp_url_is_reported_as_a_mail_error():
    with pytest.raises(MailError, match="SMTP_URL"):
        SmtpTransport("mail.example.com:587", sender="a@b.c")


def test_a_refusing_smtp_server_becomes_a_mail_error(monkeypatch):
    def refuse(*args, **kwargs):
        raise smtplib.SMTPConnectError(421, "too many connections")

    monkeypatch.setattr(smtplib, "SMTP", refuse)

    with pytest.raises(MailError):
        SmtpTransport("smtp://mail.example.com", sender="a@b.c").deliver(_letter())


# ---- API рассылочного сервиса ----------------------------------------------


class FakeResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_the_api_transport_sends_the_letter_as_json_with_the_key(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout=None):
        captured["url"] = request.full_url
        captured["headers"] = request.headers
        captured["body"] = json.loads(request.data)
        return FakeResponse()

    monkeypatch.setattr("app.mail.transports.urlopen", fake_urlopen)

    ApiTransport(
        url="https://api.example.com/emails", key="secret-key", sender="no-reply@flowline.app"
    ).deliver(_letter())

    assert captured["url"] == "https://api.example.com/emails"
    assert captured["headers"]["Authorization"] == "Bearer secret-key"
    assert captured["body"] == {
        "from": "no-reply@flowline.app",
        "to": ["alex@example.com"],
        "subject": "Тема",
        "text": "Текст",
    }


def test_an_api_rejection_becomes_a_mail_error_with_the_status(monkeypatch):
    def fake_urlopen(request, timeout=None):
        raise HTTPError(request.full_url, 422, "Unprocessable", {}, None)

    monkeypatch.setattr("app.mail.transports.urlopen", fake_urlopen)

    with pytest.raises(MailError, match="422"):
        ApiTransport(url="https://x/y", key="k", sender="a@b.c").deliver(_letter())


def test_an_unreachable_api_becomes_a_mail_error(monkeypatch):
    def fake_urlopen(request, timeout=None):
        raise URLError("name or service not known")

    monkeypatch.setattr("app.mail.transports.urlopen", fake_urlopen)

    with pytest.raises(MailError):
        ApiTransport(url="https://x/y", key="k", sender="a@b.c").deliver(_letter())


# ---- Общий интерфейс --------------------------------------------------------


def test_send_reports_a_failure_instead_of_raising(monkeypatch, caplog):
    class Broken:
        def deliver(self, letter):
            raise MailError("почтовый сервер лежит")

    monkeypatch.setattr(mail, "build_transport", lambda settings: Broken())

    with caplog.at_level(logging.ERROR):
        delivered = mail.send(
            to="alex@example.com",
            template="verify_email",
            locale="ru",
            params={"name": "Алекс", "link": "L", "hours": 24},
        )

    # Действие, ради которого письмо отправлялось, уже состоялось —
    # исключение отсюда откатило бы его целиком.
    assert delivered is False
    assert "не ушло" in caplog.text


def test_send_hands_the_rendered_letter_to_the_transport(mailbox):
    assert (
        mail.send(
            to="alex@example.com",
            template="verify_email",
            locale="ru",
            params={"name": "Алекс", "link": "https://x/y", "hours": 24},
        )
        is True
    )

    (letter,) = mailbox
    assert letter.to == "alex@example.com"
    assert "https://x/y" in letter.body


# ---- Письмо-приглашение -----------------------------------------------------

# Проверяется и то, что в письме есть, и то, чего в нём быть не должно: оно
# уходит на адрес, который никто ещё не подтверждал, и всё, что попадёт в его
# текст, попадёт неизвестно кому.

_INVITE = {
    "org": "Acme",
    "inviter": "Мария",
    "link": "https://flowline.example.com/invite/abc",
    "expires": "2026-08-18",
}


def _invitation(locale: str = "ru") -> Letter:
    return render(
        "invitation",
        locale,
        {**_INVITE, "role": mail.role_name("editor", locale)},
        to="guest@example.com",
    )


def test_the_invitation_says_who_invites_where_and_until_when():
    letter = _invitation()

    assert letter.to == "guest@example.com"
    assert "Acme" in letter.subject
    assert "Мария" in letter.body
    assert "редактор" in letter.body
    assert "https://flowline.example.com/invite/abc" in letter.body
    assert "2026-08-18" in letter.body


def test_the_invitation_speaks_the_language_of_the_organization():
    assert "invites you" in _invitation("en").body
    assert "dəvət edir" in _invitation("az").body
    assert "editor" in _invitation("en").body
    assert "redaktor" in _invitation("az").body


def test_an_unknown_organization_language_falls_back_instead_of_failing():
    """Язык организации — колонка в базе; попавшее в неё незнакомое значение
    не должно превращать приглашение в исключение."""
    assert "https://flowline.example.com/invite/abc" in _invitation("kl").body


def test_an_unknown_role_reaches_the_letter_as_it_is():
    """Роль переводится по словарю, но письмо из-за незнакомой не пропадает:
    она уходит машинным именем, а не срывает отправку приглашения."""
    assert mail.role_name("auditor", "ru") == "auditor"
