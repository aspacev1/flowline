import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app


@pytest.fixture
def client(db):
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


@pytest.fixture
def project_id(authed):
    return authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]


@pytest.fixture
def published(authed, project_id):
    authed.put(
        f"/api/projects/{project_id}/share", json={"published": True, "comments_enabled": True}
    )
    return project_id


def address(authed, project_id) -> str:
    slug = authed.get(f"/api/projects/{project_id}/settings").json()["slug"]
    return f"/api/public/alex/{slug}"


def guest_client() -> TestClient:
    """Отдельный клиент без куки: у гостя сессии нет, и брать её неоткуда.

    Тот же `app` и та же подменённая сессия базы — меняется только то, что
    запрос приходит анонимным.
    """
    return TestClient(app)


def test_a_guest_reads_a_published_project_without_a_session(client, authed, published):
    response = guest_client().get(address(authed, published))

    assert response.status_code == 200
    assert response.json()["name"] == "Redesign"


def test_a_guest_sees_neither_internal_notes_nor_assignees(client, authed, published):
    category = authed.post(
        f"/api/projects/{published}/mutations",
        json={"op": {"type": "create_category", "name": "Дизайн", "color": "#3b82f6"}},
    ).json()["op"]["category_id"]
    authed.post(
        f"/api/projects/{published}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category,
                "name": "Логотип",
                "start_date": "2026-03-04",
                "duration_days": 5,
                "internal_note": "клиент платит с задержкой",
            }
        },
    )

    task = guest_client().get(address(authed, published)).json()["tasks"][0]

    assert "internal_note" not in task
    assert "assignee_ids" not in task
    # Всё остальное на месте: гость видит ту же раскладку, а не огрызок.
    assert task["name"] == "Логотип"
    assert task["end_date"] == "2026-03-10"


def test_an_unpublished_project_is_not_found(client, authed, project_id):
    assert guest_client().get(address(authed, project_id)).status_code == 404


def test_a_revoked_address_dies_immediately(client, authed, published):
    guest = guest_client()
    assert guest.get(address(authed, published)).status_code == 200

    authed.put(
        f"/api/projects/{published}/share", json={"published": False, "comments_enabled": True}
    )

    assert guest.get(address(authed, published)).status_code == 404


def test_unknown_addresses_answer_exactly_like_a_revoked_one(client, authed, published):
    """Разные ответы рассказали бы перебором, какие организации существуют."""
    guest = guest_client()

    assert guest.get("/api/public/globex/redesign").status_code == 404
    assert guest.get("/api/public/alex/no-such-project").status_code == 404


def test_the_state_says_whether_comments_are_open(client, authed, published):
    guest = guest_client()
    assert guest.get(address(authed, published)).json()["comments_enabled"] is True

    authed.put(
        f"/api/projects/{published}/share", json={"published": True, "comments_enabled": False}
    )

    assert guest.get(address(authed, published)).json()["comments_enabled"] is False


def test_renaming_the_slug_moves_the_address(client, authed, published):
    """Обещанный спекой перевыпуск: по прежнему адресу больше ничего нет."""
    guest = guest_client()
    old = address(authed, published)
    assert guest.get(old).status_code == 200

    authed.put(f"/api/projects/{published}/slug", json={"slug": "redesign-2027"})

    assert guest.get(old).status_code == 404
    assert guest.get("/api/public/alex/redesign-2027").status_code == 200
