"""Публичная страница глазами гостя: чтение по ссылке и комментарии."""

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import get_db
from app.main import app
from app.rate_limit import SlidingWindow


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


@pytest.fixture(autouse=True)
def fresh_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def fresh_rate_limit(monkeypatch):
    """Счётчик гостевых комментариев живёт в памяти процесса: без сброса
    один тест доедал бы окно следующего."""
    import app.api.public_routes as public_routes

    monkeypatch.setattr(public_routes, "_guest_comments", None)


@pytest.fixture
def published(authed):
    """Проект с одной задачей и действующей публичной ссылкой."""
    project_id = authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]
    category_id = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "create_category", "name": "Design", "color": "#3b82f6"}},
    ).json()["op"]["category_id"]
    task_id = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category_id,
                "name": "Logo",
                "start_date": "2026-03-06",
                "duration_days": 3,
                "internal_note": "заказчик придирчив",
            }
        },
    ).json()["op"]["task_id"]

    url = authed.post(f"/api/projects/{project_id}/share").json()["url"]
    token = url.split("?s=")[1]
    return {
        "project_id": project_id,
        "task_id": task_id,
        "token": token,
        "path": f"/api/public/alex/redesign",
    }


def _guest(client, published, suffix: str = "", **params):
    query = {"s": published["token"], **params}
    return client.get(published["path"] + suffix, params=query)


def test_a_guest_reads_the_shared_project(client, published):
    response = _guest(client, published)

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Redesign"
    assert [task["name"] for task in body["tasks"]] == ["Logo"]
    # Даты окончания считает сервер и на публичной странице тоже: гость
    # видит ту же диаграмму, а не её упрощённую копию.
    assert body["tasks"][0]["end_date"] == "2026-03-10"
    assert body["org"]["name"] == "Alex"


def test_a_guest_sees_the_task_status(client, published):
    # Статус — не секрет: публичная страница показывает те же полоски
    # готовности, что и рабочий экран.
    body = _guest(client, published).json()
    assert body["tasks"][0]["status"] == "planned"


def test_a_guest_never_sees_the_internal_note(client, published):
    body = _guest(client, published).json()

    assert "internal_note" not in body["tasks"][0]


def test_a_guest_does_not_see_who_works_on_the_project(client, authed, published):
    user_id = authed.get("/api/auth/me").json()["id"]
    authed.post(
        f"/api/projects/{published['project_id']}/mutations",
        json={"op": {"type": "assign_user", "task_id": published["task_id"], "user_id": user_id}},
    )

    body = _guest(client, published).json()

    # Состав организации наружу не выходит: по спецификации его не видит даже
    # client с аккаунтом, а гость — тем более.
    assert body["tasks"][0]["assignee_ids"] == []
    # А участнику исполнители по-прежнему видны.
    owner_state = authed.get(f"/api/projects/{published['project_id']}").json()
    assert owner_state["tasks"][0]["assignee_ids"] == [user_id]


def test_a_wrong_token_is_indistinguishable_from_a_missing_project(client, published):
    assert client.get(published["path"], params={"s": "not-the-token"}).status_code == 404
    assert client.get(published["path"]).status_code == 404
    assert client.get("/api/public/alex/no-such-project", params={"s": published["token"]}).status_code == 404


def test_a_guest_signs_his_comment_with_a_name(client, published):
    response = client.post(
        published["path"] + "/comments",
        params={"s": published["token"]},
        json={"name": "  Нигяр  ", "body": "Сроки по логотипу устраивают"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["author"] == {"name": "Нигяр", "guest": True}
    assert body["body"] == "Сроки по логотипу устраивают"

    listed = _guest(client, published, "/comments").json()
    assert [c["id"] for c in listed] == [body["id"]]


def test_a_guest_comment_reaches_the_project_team(client, authed, published):
    client.post(
        published["path"] + "/comments",
        params={"s": published["token"]},
        json={"name": "Нигяр", "body": "Когда будет макет?"},
    )

    listed = authed.get(f"/api/projects/{published['project_id']}/comments").json()

    # Смысл публичной ссылки в том, чтобы разговор с клиентом жил в проекте,
    # а не в почте: гостевая реплика приходит команде в ту же ленту.
    assert [(c["author"]["name"], c["author"]["guest"]) for c in listed] == [("Нигяр", True)]


def test_a_comment_can_be_pinned_to_a_task(client, published):
    response = client.post(
        published["path"] + "/comments",
        params={"s": published["token"]},
        json={"name": "Нигяр", "body": "Эта задача важнее", "task_id": published["task_id"]},
    )

    assert response.json()["task_id"] == published["task_id"]
    by_task = _guest(client, published, "/comments", task_id=published["task_id"]).json()
    assert len(by_task) == 1


def test_a_comment_about_a_foreign_task_is_not_accepted(client, authed, published):
    other_project = authed.post("/api/projects", json={"name": "Другой"}).json()["id"]
    other_category = authed.post(
        f"/api/projects/{other_project}/mutations",
        json={"op": {"type": "create_category", "name": "Плановые", "color": "#3b82f6"}},
    ).json()["op"]["category_id"]
    foreign_task = authed.post(
        f"/api/projects/{other_project}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": other_category,
                "name": "Смета",
                "start_date": "2026-03-06",
                "duration_days": 2,
            }
        },
    ).json()["op"]["task_id"]

    response = client.post(
        published["path"] + "/comments",
        params={"s": published["token"]},
        json={"name": "Нигяр", "body": "Вижу вашу задачу", "task_id": foreign_task},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "task_not_found"


def test_an_empty_comment_is_refused(client, published):
    response = client.post(
        published["path"] + "/comments",
        params={"s": published["token"]},
        json={"name": "Нигяр", "body": "   "},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "comment_empty"


def test_switched_off_comments_close_writing_but_not_reading(client, authed, published):
    client.post(
        published["path"] + "/comments",
        params={"s": published["token"]},
        json={"name": "Нигяр", "body": "Первая реплика"},
    )
    authed.patch(
        f"/api/projects/{published['project_id']}/share", json={"comments_enabled": False}
    )

    refused = client.post(
        published["path"] + "/comments",
        params={"s": published["token"]},
        json={"name": "Нигяр", "body": "И вторая"},
    )

    assert refused.status_code == 403
    assert refused.json()["detail"] == "comments_closed"
    # Сказанное вчера не исчезает от щелчка переключателем.
    assert len(_guest(client, published, "/comments").json()) == 1
    assert _guest(client, published).json()["comments_enabled"] is False


def test_a_flood_of_guest_comments_is_cut_off(client, published, monkeypatch):
    import app.api.public_routes as public_routes

    monkeypatch.setattr(
        public_routes, "_guest_comments", SlidingWindow(limit=2, window=3600.0)
    )

    def post(text: str):
        return client.post(
            published["path"] + "/comments",
            params={"s": published["token"]},
            json={"name": "Нигяр", "body": text},
        )

    assert post("раз").status_code == 201
    assert post("два").status_code == 201
    refused = post("три")
    assert refused.status_code == 429
    assert refused.json()["detail"] == "too_many_comments"


def test_guests_are_counted_apart_from_each_other(client, published, monkeypatch):
    import app.api.public_routes as public_routes

    monkeypatch.setattr(
        public_routes, "_guest_comments", SlidingWindow(limit=1, window=3600.0)
    )

    def post(text: str, address: str):
        return client.post(
            published["path"] + "/comments",
            params={"s": published["token"]},
            json={"name": "Нигяр", "body": text},
            headers={"X-Forwarded-For": address},
        )

    assert post("раз", "203.0.113.7").status_code == 201
    assert post("два", "203.0.113.7").status_code == 429
    # Потолок на адрес, а не на страницу: иначе один говорливый гость
    # затыкал бы всех остальных читателей ссылки.
    assert post("раз", "198.51.100.4").status_code == 201


def test_a_closed_installation_closes_the_pages_already_published(client, published, monkeypatch):
    monkeypatch.setenv("PUBLIC_SHARING_ENABLED", "false")
    get_settings.cache_clear()

    assert _guest(client, published).status_code == 404
