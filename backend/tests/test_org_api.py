import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import get_db
from app.main import app


@pytest.fixture
def client(db):
    """Тот же паттерн, что в tests/test_project_api.py: get_db отдаёт сессию
    фикстуры `db` и не делает commit, иначе внешняя транзакция закроется
    раньше времени и изоляция между тестами исчезнет."""

    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def authed(client):
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    return client


def test_current_organization_is_named(authed):
    """Шапка интерфейса подписана названием организации, и взять его больше
    неоткуда: состав участников про саму организацию ничего не говорит."""
    response = authed.get("/api/org")
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Alex"
    assert body["slug"] == "alex"
    assert body["role"] == "owner"


def test_current_organization_requires_authentication(client):
    assert client.get("/api/org").status_code == 401


def test_a_client_still_knows_which_organization_they_are_in(authed, db):
    """В отличие от состава участников, само название организации от её
    участника не скрывается: он видит его в шапке на каждом экране, и роль
    `client` здесь ничего не меняет."""
    from app.models import Membership

    user_id = authed.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
    membership.role = "client"
    db.flush()

    response = authed.get("/api/org")
    assert response.status_code == 200
    assert response.json()["role"] == "client"


def test_members_lists_only_this_organization(authed, db):
    from app.auth import register

    register(db, name="Stranger", email="stranger@example.com", password="s3cret-pass")
    db.flush()

    response = authed.get("/api/org/members")
    assert response.status_code == 200
    emails = [m["email"] for m in response.json()]
    assert "stranger@example.com" not in emails


def test_members_requires_authentication(client):
    assert client.get("/api/org/members").status_code == 401


def test_members_returns_id_name_email_and_role(authed):
    response = authed.get("/api/org/members")
    assert response.status_code == 200
    [me] = response.json()
    assert me["name"] == "Alex"
    assert me["email"] == "alex@example.com"
    assert me["role"] == "owner"
    assert me["id"] == authed.get("/api/auth/me").json()["id"]


def test_a_client_does_not_see_the_organization_roster(authed, db):
    """По спеку роль client состава организации не видит вовсе.

    Здесь 403, а не 404: маршрут не про конкретный проект, и скрывать факт
    существования собственной организации от её же участника нечего.
    """
    from app.models import Membership

    user_id = authed.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
    membership.role = "client"
    db.flush()

    assert authed.get("/api/org/members").status_code == 403
