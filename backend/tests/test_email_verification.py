"""Подтверждение адреса: выдача ссылки, её погашение и повторная отправка.

Письма перехватываются фикстурой `mailbox` (tests/conftest.py) — ни один
тест не открывает сокет. Проверяется то, что решает наш код: одноразовость
ссылки, срок жизни, язык письма и то, что недоступная почта не отменяет
регистрацию.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.auth import open_session, register
from app.db import get_db
from app.email_verification import (
    RESEND_COOLDOWN,
    VERIFICATION_TTL,
    VerificationError,
    confirm_email,
    issue_token,
    send_verification,
    verification_link,
)
from app.main import app
from app.models import EmailVerification, User


@pytest.fixture
def user(db):
    created = register(db, name="Alex", email="alex@example.com", password="s3cret-pass")
    db.flush()
    return created


@pytest.fixture
def client(db):
    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _token_of(text: str) -> str:
    """Токен из ссылки — так же, как его достаёт из письма человек."""
    return text.partition("token=")[2].split()[0]


# ---- Выдача и погашение -----------------------------------------------------


def test_the_open_token_is_not_what_lands_in_the_database(db, user):
    raw = issue_token(db, user)

    record = db.query(EmailVerification).filter_by(user_id=user.id).one()
    assert record.token_hash != raw
    assert raw not in record.token_hash


def test_confirming_stamps_the_user_and_burns_the_token(db, user):
    raw = issue_token(db, user)
    assert user.email_verified_at is None

    confirmed = confirm_email(db, raw)

    assert confirmed.id == user.id
    assert confirmed.email_verified_at is not None
    assert db.query(EmailVerification).filter_by(user_id=user.id).count() == 0

    # Вторая попытка по той же ссылке ничего не даёт: токен погашен.
    with pytest.raises(VerificationError) as exc_info:
        confirm_email(db, raw)
    assert exc_info.value.code == "invalid_token"


def test_an_unknown_token_is_rejected(db, user):
    with pytest.raises(VerificationError) as exc_info:
        confirm_email(db, "made-up-token")
    assert exc_info.value.code == "invalid_token"


def test_an_expired_link_is_rejected_and_swept_away(db, user):
    raw = issue_token(db, user)
    record = db.query(EmailVerification).filter_by(user_id=user.id).one()
    record.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.flush()

    with pytest.raises(VerificationError) as exc_info:
        confirm_email(db, raw)

    assert exc_info.value.code == "token_expired"
    assert db.get(User, user.id).email_verified_at is None
    assert db.query(EmailVerification).filter_by(user_id=user.id).count() == 0


def test_a_new_link_invalidates_the_previous_one(db, user):
    first = issue_token(db, user)
    second = issue_token(db, user)

    with pytest.raises(VerificationError):
        confirm_email(db, first)
    assert confirm_email(db, second).email_verified_at is not None


def test_the_link_is_built_from_the_public_base_url(db, user):
    raw = issue_token(db, user)
    link = verification_link(raw)

    assert link.startswith("http")
    assert "/verify-email?token=" in link
    assert _token_of(link)


# ---- Письмо -----------------------------------------------------------------


def test_the_letter_goes_out_in_the_language_of_its_recipient(db, user, mailbox):
    user.locale = "ru"
    db.flush()

    assert send_verification(db, user) is True

    (letter,) = mailbox
    assert letter.to == "alex@example.com"
    assert "подтвердите" in letter.subject.lower()
    assert "Alex" in letter.body
    assert str(int(VERIFICATION_TTL.total_seconds() // 3600)) in letter.body

    # Ссылка из письма действительно работает — иначе проверять текст
    # письма бессмысленно.
    assert confirm_email(db, _token_of(letter.body)).email_verified_at is not None


def test_an_undelivered_letter_still_leaves_a_usable_token(db, user, monkeypatch):
    import app.mail as mail_module

    class Broken:
        def deliver(self, letter):
            raise mail_module.MailError("почтовый сервер лежит")

    monkeypatch.setattr(mail_module, "build_transport", lambda settings: Broken())

    assert send_verification(db, user) is False
    # Токен выдан: человек может попросить письмо ещё раз, когда сервер
    # починят, — и старая ссылка при этом уступит место новой.
    assert db.query(EmailVerification).filter_by(user_id=user.id).count() == 1


# ---- Маршруты ---------------------------------------------------------------


def test_registration_sends_the_letter_and_leaves_the_address_unconfirmed(client, mailbox):
    response = client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )

    assert response.status_code == 201
    assert response.json()["email_verified"] is False
    (letter,) = mailbox
    assert letter.to == "alex@example.com"


def test_registration_survives_a_dead_mail_server(client, monkeypatch):
    import app.mail as mail_module

    class Broken:
        def deliver(self, letter):
            raise mail_module.MailError("почтовый сервер лежит")

    monkeypatch.setattr(mail_module, "build_transport", lambda settings: Broken())

    response = client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )

    assert response.status_code == 201


def test_the_link_from_the_letter_confirms_without_a_session(client, mailbox):
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    token = _token_of(mailbox[0].body)
    # Письмо открывают в том браузере, куда пришла почта, а не обязательно
    # в том, где открыта сессия.
    client.cookies.clear()

    response = client.post("/api/auth/verify-email", json={"token": token})

    assert response.status_code == 204


def test_me_reports_the_address_as_confirmed_afterwards(client, mailbox):
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    client.post("/api/auth/verify-email", json={"token": _token_of(mailbox[0].body)})

    assert client.get("/api/auth/me").json()["email_verified"] is True


def test_a_made_up_token_is_a_400_with_a_machine_code(client):
    response = client.post("/api/auth/verify-email", json={"token": "nope"})

    assert response.status_code == 400
    assert response.json()["detail"] == "invalid_token"


def test_resend_needs_a_session(client):
    assert client.post("/api/auth/verify-email/resend").status_code == 401


def test_resend_waits_out_the_cooldown(client, db, mailbox):
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )

    assert client.post("/api/auth/verify-email/resend").status_code == 429

    # Отматываем выдачу назад — как если бы прошла минута.
    record = db.query(EmailVerification).one()
    record.created_at = datetime.now(timezone.utc) - RESEND_COOLDOWN - timedelta(seconds=1)
    db.flush()

    response = client.post("/api/auth/verify-email/resend")
    assert response.status_code == 200
    assert response.json() == {"sent": True}
    assert len(mailbox) == 2


def test_resend_says_so_when_the_letter_did_not_go_out(client, db, monkeypatch, mailbox):
    import app.mail as mail_module

    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    db.query(EmailVerification).one().created_at = (
        datetime.now(timezone.utc) - RESEND_COOLDOWN - timedelta(seconds=1)
    )
    db.flush()

    class Broken:
        def deliver(self, letter):
            raise mail_module.MailError("почтовый сервер лежит")

    monkeypatch.setattr(mail_module, "build_transport", lambda settings: Broken())

    # «Отправлено» вместо правды означало бы, что человек будет ждать
    # письмо, которого нет.
    assert client.post("/api/auth/verify-email/resend").json() == {"sent": False}


def test_resend_refuses_once_the_address_is_confirmed(client, mailbox):
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    client.post("/api/auth/verify-email", json={"token": _token_of(mailbox[0].body)})

    response = client.post("/api/auth/verify-email/resend")

    assert response.status_code == 409
    assert response.json()["detail"] == "already_verified"


def test_deleting_a_user_takes_their_unused_links_along(db, user):
    issue_token(db, user)
    db.delete(user)
    db.flush()

    assert db.query(EmailVerification).count() == 0


def test_a_session_alone_does_not_confirm_anything(db, user):
    open_session(db, user)
    db.flush()

    assert db.get(User, user.id).email_verified_at is None
