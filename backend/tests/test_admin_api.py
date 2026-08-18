"""Панель директора: /api/admin/users.

Доступ решает не роль в организации, а роль директора — она закреплена
переменной окружения DIRECTOR_EMAIL (см. app.config.Settings), а не константой
кода. tests/conftest.py задаёт ей значение по умолчанию — "director@example.com"
— тем же способом, что и APP_SECRET; тесты, которым нужен другой адрес,
подменяют переменную monkeypatch'ем и сбрасывают кэш настроек, как и остальные
рубильники (см. test_comments_api.py::test_a_comment_longer_than_the_limit_is_refused).
"""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import register
from app.config import get_settings
from app.db import get_db
from app.main import app
from app.models import Membership

#: Тот же адрес, что tests/conftest.py прописывает в DIRECTOR_EMAIL по
#: умолчанию — заводить его в каждом тесте константой рядом со строкой было бы
#: тем же дублированием, что и держать APP_SECRET в двух местах, но раз
#: переменная окружения не отдаёт значение обратно как импортируемый символ,
#: приходится повторить строку здесь.
DIRECTOR_EMAIL = "director@example.com"


@pytest.fixture
def clients(db):
    """Фабрика клиентов поверх одной сессии базы — как в test_org_api.py.

    Каждый вызов — новая кука, то есть новый вошедший; сессия базы общая,
    иначе директор не увидел бы регистрации, сделанные вторым клиентом.
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
def director(client):
    """Клиент, вошедший под адресом из DIRECTOR_EMAIL."""
    _register(client, "Director", DIRECTOR_EMAIL)
    return client


def test_admin_route_requires_authentication(client):
    assert client.get("/api/admin/users").status_code == 401


def test_a_plain_user_is_refused_with_403_not_404(client):
    """403, а не 404: раздел не называет никакой сущности, о существовании
    которой стоило бы молчать, — от не-директора прячет пункт меню интерфейс,
    а не сервер."""
    _register(client, "Alex", "alex@example.com")

    response = client.get("/api/admin/users")

    assert response.status_code == 403
    assert response.json()["detail"] == "forbidden"


def test_nobody_else_gets_in_even_when_the_director_is_registered(director, clients):
    """DIRECTOR_EMAIL — не список, а один адрес, и второй зарегистрированный
    человек в панель не попадает, кем бы он ни был."""
    stranger = clients()
    _register(stranger, "Maria", "maria@example.com")

    assert stranger.get("/api/admin/users").status_code == 403
    # Директор при этом видит панель как обычно.
    assert director.get("/api/admin/users").status_code == 200


def test_admin_lists_every_registration(director, db):
    register(db, name="Maria", email="maria@example.com", password="s3cret-pass")
    db.flush()

    response = director.get("/api/admin/users")
    assert response.status_code == 200
    emails = {row["email"] for row in response.json()}
    assert emails == {DIRECTOR_EMAIL, "maria@example.com"}


def test_admin_row_carries_registration_and_activity(director):
    rows = director.get("/api/admin/users").json()
    [row] = [row for row in rows if row["email"] == DIRECTOR_EMAIL]

    assert row["name"] == "Director"
    # Регистрация уже сама по себе активность — см. open_session в app.auth.
    assert row["created_at"] is not None
    assert row["last_active_at"] is not None
    assert row["organizations"] == ["Director"]


def test_the_most_recent_registration_comes_first(director, db):
    # created_at использует server_default=func.now(): внутри одной
    # транзакции теста (см. tests/conftest.py::db) это отдаёт одну и ту же
    # отметку двум подряд идущим регистрациям — то, чего не бывает в бою, где
    # у каждой регистрации своя транзакция. Метка сдвигается руками, чтобы
    # проверять именно сортировку маршрута, а не совпадение часов теста.
    maria = register(db, name="Maria", email="maria@example.com", password="s3cret-pass")
    db.flush()
    maria.created_at = maria.created_at + timedelta(hours=1)
    db.flush()

    rows = director.get("/api/admin/users").json()
    assert rows[0]["email"] == "maria@example.com"


def test_a_user_outside_any_organization_still_lists_with_an_empty_roster(director, db):
    person = register(db, name="Solo", email="solo@example.com", password="s3cret-pass")
    db.flush()
    # Единственное членство — своя же организация, заведённая регистрацией.
    membership = db.scalar(select(Membership).where(Membership.user_id == person.id))
    db.delete(membership)
    db.flush()

    rows = director.get("/api/admin/users").json()
    [row] = [row for row in rows if row["email"] == "solo@example.com"]
    assert row["organizations"] == []


def test_director_email_comparison_is_case_and_form_insensitive(client, monkeypatch):
    """Роль директора сравнивается той же нормализацией, что и уникальность
    аккаунта: адрес в DIRECTOR_EMAIL не обязан побуквенно совпадать регистром
    с тем, что ввели при регистрации."""
    monkeypatch.setenv("DIRECTOR_EMAIL", "Owner@Example.com")
    get_settings.cache_clear()
    try:
        _register(client, "Owner", "owner@example.com")
        response = client.get("/api/admin/users")
    finally:
        get_settings.cache_clear()

    assert response.status_code == 200


def test_changing_the_variable_moves_the_role_without_touching_code(client, clients, monkeypatch):
    """Смена директора — правка DIRECTOR_EMAIL, а не редактирование кода."""
    monkeypatch.setenv("DIRECTOR_EMAIL", "new-director@example.com")
    get_settings.cache_clear()
    try:
        _register(client, "Old Director", DIRECTOR_EMAIL)
        newcomer = clients()
        _register(newcomer, "New Director", "new-director@example.com")

        old_response = client.get("/api/admin/users")
        new_response = newcomer.get("/api/admin/users")
    finally:
        get_settings.cache_clear()

    assert old_response.status_code == 403
    assert new_response.status_code == 200


def test_me_reflects_director_status(director, clients):
    assert director.get("/api/auth/me").json()["is_director"] is True

    stranger = clients()
    _register(stranger, "Alex", "alex@example.com")
    assert stranger.get("/api/auth/me").json()["is_director"] is False
