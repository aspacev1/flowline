import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.rate_limit import RateLimiter


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
def published(authed):
    project_id = authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]
    authed.put(
        f"/api/projects/{project_id}/share", json={"published": True, "comments_enabled": True}
    )
    return project_id


@pytest.fixture(autouse=True)
def fresh_limiter(monkeypatch):
    """Ограничитель живёт в модуле и переживает тест. Без сброса второй тест
    приходит к уже израсходованному окну первого."""
    from app.api import public_routes

    monkeypatch.setattr(
        public_routes, "_guest_limiter", RateLimiter(limit=100, window_seconds=3600)
    )


def address(authed, project_id) -> str:
    slug = authed.get(f"/api/projects/{project_id}/settings").json()["slug"]
    return f"/api/public/alex/{slug}"


def test_a_guest_leaves_a_reply_signed_by_the_name_they_gave(client, authed, published):
    guest = TestClient(app)

    response = guest.post(
        f"{address(authed, published)}/comments",
        json={"body": "А когда сдача?", "guest_name": "Нигяр"},
    )

    assert response.status_code == 201
    assert response.json()["guest_name"] == "Нигяр"
    assert response.json()["author"] is None


def test_guests_and_members_read_the_same_thread(client, authed, published):
    guest = TestClient(app)
    guest.post(
        f"{address(authed, published)}/comments",
        json={"body": "вопрос гостя", "guest_name": "Нигяр"},
    )
    authed.post(f"/api/projects/{published}/comments", json={"body": "ответ участника"})

    seen_by_guest = guest.get(f"{address(authed, published)}/comments").json()

    assert [c["body"] for c in seen_by_guest] == ["вопрос гостя", "ответ участника"]
    # Участник подписан именем аккаунта, гость — своим: различить их обязан
    # ответ, а не догадка интерфейса.
    assert seen_by_guest[0]["guest_name"] == "Нигяр"
    assert seen_by_guest[1]["author"]["name"] == "Alex"


def test_a_reply_without_a_name_is_refused(client, authed, published):
    guest = TestClient(app)

    response = guest.post(
        f"{address(authed, published)}/comments", json={"body": "аноним", "guest_name": "  "}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "guest_name_required"


def test_replies_are_refused_when_the_owner_switched_comments_off(client, authed, published):
    authed.put(
        f"/api/projects/{published}/share", json={"published": True, "comments_enabled": False}
    )
    guest = TestClient(app)

    response = guest.post(
        f"{address(authed, published)}/comments", json={"body": "?", "guest_name": "Нигяр"}
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "comments_disabled"


def test_a_revoked_address_takes_the_thread_with_it(client, authed, published):
    guest = TestClient(app)
    at = address(authed, published)
    authed.put(
        f"/api/projects/{published}/share", json={"published": False, "comments_enabled": True}
    )

    assert guest.get(f"{at}/comments").status_code == 404
    assert (
        guest.post(f"{at}/comments", json={"body": "?", "guest_name": "Нигяр"}).status_code == 404
    )


def test_a_guest_cannot_reach_the_thread_of_a_single_task(client, authed, published):
    """Карточки задачи на публичной странице нет: отдавать ленту, которую
    негде показать, значит расширять поверхность без повода."""
    guest = TestClient(app)

    seen = guest.get(f"{address(authed, published)}/comments?task_id=whatever").json()

    assert seen == []


def test_too_many_replies_from_one_address_are_refused(client, authed, published, monkeypatch):
    """Потолок берётся из GUEST_COMMENT_RATE_LIMIT, а не из константы в коде."""
    from app.api import public_routes

    monkeypatch.setattr(public_routes, "_guest_limiter", RateLimiter(limit=2, window_seconds=3600))
    guest = TestClient(app)
    at = address(authed, published)

    for _ in range(2):
        assert (
            guest.post(f"{at}/comments", json={"body": "ещё", "guest_name": "Нигяр"}).status_code
            == 201
        )

    refused = guest.post(f"{at}/comments", json={"body": "и ещё", "guest_name": "Нигяр"})

    assert refused.status_code == 429
    assert refused.json()["detail"] == "too_many_comments"


def test_the_limit_does_not_touch_members(client, authed, published, monkeypatch):
    """Ограничитель гостевой: у участника есть аккаунт, и потолок по адресу
    задел бы целый офис за одним общим адресом."""
    from app.api import public_routes

    monkeypatch.setattr(public_routes, "_guest_limiter", RateLimiter(limit=0, window_seconds=3600))

    assert (
        authed.post(f"/api/projects/{published}/comments", json={"body": "можно"}).status_code == 201
    )
