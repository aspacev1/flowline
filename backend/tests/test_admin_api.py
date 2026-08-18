"""Панель владельца установки: /api/admin/users.

Доступ решает не роль в организации, а ADMIN_EMAILS в настройках — тесты
включают его monkeypatch'ем окружения, тем же способом, что и остальные
рубильники (см. test_comments_api.py::test_a_comment_longer_than_the_limit_is_refused).
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import register
from app.config import get_settings
from app.db import get_db
from app.main import app
from app.models import Membership


@pytest.fixture
def clients(db):
    """Фабрика клиентов поверх одной сессии базы — как в test_org_api.py.

    Каждый вызов — новая кука, то есть новый вошедший; сессия базы общая,
    иначе владелец не увидел бы регистрации, сделанные вторым клиентом.
    """

    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield lambda: TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def client(clients):
    return clients()


def _register(client, name, email):
    return client.post(
        "/api/auth/register",
        json={"name": name, "email": email, "password": "s3cret-pass", "company_name": name},
    )


@pytest.fixture
def admin(monkeypatch, client):
    """Клиент, вошедший под адресом из ADMIN_EMAILS."""
    monkeypatch.setenv("ADMIN_EMAILS", "owner@example.com, Other@Example.com")
    get_settings.cache_clear()
    _register(client, "Owner", "owner@example.com")
    yield client
    get_settings.cache_clear()


def test_admin_route_requires_authentication(client):
    assert client.get("/api/admin/users").status_code == 401


def test_a_plain_user_is_refused_with_403_not_404(client):
    """403, а не 404: раздел не называет никакой сущности, о существовании
    которой стоило бы молчать, — от не-владельца прячет пункт меню интерфейс,
    а не сервер."""
    # ADMIN_EMAILS пуст по умолчанию (см. app.config.Settings.admin_emails).
    _register(client, "Alex", "alex@example.com")

    response = client.get("/api/admin/users")

    assert response.status_code == 403
    assert response.json()["detail"] == "forbidden"


def test_an_unlisted_email_is_refused_even_when_the_list_is_not_empty(admin, clients):
    stranger = clients()
    _register(stranger, "Maria", "maria@example.com")

    assert stranger.get("/api/admin/users").status_code == 403
    # Владелец при этом видит панель как обычно — список не запирает никого,
    # кроме того, кого в нём нет.
    assert admin.get("/api/admin/users").status_code == 200


def test_admin_lists_every_registration(admin, db):
    register(db, name="Maria", email="maria@example.com", password="s3cret-pass")
    db.flush()

    response = admin.get("/api/admin/users")
    assert response.status_code == 200
    emails = {row["email"] for row in response.json()}
    assert emails == {"owner@example.com", "maria@example.com"}


def test_admin_row_carries_registration_and_activity(admin):
    rows = admin.get("/api/admin/users").json()
    [row] = [row for row in rows if row["email"] == "owner@example.com"]

    assert row["name"] == "Owner"
    # Регистрация уже сама по себе активность — см. open_session в app.auth.
    assert row["created_at"] is not None
    assert row["last_active_at"] is not None
    assert row["organizations"] == ["Owner"]


def test_the_most_recent_registration_comes_first(admin, db):
    # created_at использует server_default=func.now(): внутри одной
    # транзакции теста (см. tests/conftest.py::db) это отдаёт одну и ту же
    # отметку двум подряд идущим регистрациям — то, чего не бывает в бою, где
    # у каждой регистрации своя транзакция. Метка сдвигается руками, чтобы
    # проверять именно сортировку маршрута, а не совпадение часов теста.
    from datetime import timedelta

    maria = register(db, name="Maria", email="maria@example.com", password="s3cret-pass")
    db.flush()
    maria.created_at = maria.created_at + timedelta(hours=1)
    db.flush()

    rows = admin.get("/api/admin/users").json()
    assert rows[0]["email"] == "maria@example.com"


def test_a_user_outside_any_organization_still_lists_with_an_empty_roster(admin, db):
    person = register(db, name="Solo", email="solo@example.com", password="s3cret-pass")
    db.flush()
    # Единственное членство — своя же организация, заведённая регистрацией.
    membership = db.scalar(select(Membership).where(Membership.user_id == person.id))
    db.delete(membership)
    db.flush()

    rows = admin.get("/api/admin/users").json()
    [row] = [row for row in rows if row["email"] == "solo@example.com"]
    assert row["organizations"] == []


def test_email_comparison_is_case_and_form_insensitive(client, monkeypatch):
    """ADMIN_EMAILS сравнивается той же нормализацией, что и уникальность
    аккаунта: адрес в .env не обязан совпадать регистром с тем, что ввели при
    регистрации."""
    monkeypatch.setenv("ADMIN_EMAILS", "Owner@Example.com")
    get_settings.cache_clear()
    try:
        _register(client, "Owner", "owner@example.com")
        response = client.get("/api/admin/users")
    finally:
        get_settings.cache_clear()

    assert response.status_code == 200


def test_me_reflects_admin_status(admin, clients):
    assert admin.get("/api/auth/me").json()["is_admin"] is True

    stranger = clients()
    _register(stranger, "Alex", "alex@example.com")
    assert stranger.get("/api/auth/me").json()["is_admin"] is False
