"""Интеграция с Jira: подключение, импорт проекта, повторная синхронизация.

Сети в тестах нет: `RecordedJiraClient` подменяет `client_for` в маршрутах —
не заглушка «чтобы компилировалось», а полноправная реализация того же
протокола, что и боевой HTTP-клиент (см. app/jira/client.py).
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.crypto import decrypt
from app.db import get_db
from app.jira.client import RecordedJiraClient
from app.main import app
from app.models import (
    Category,
    JiraCategoryLink,
    JiraConnection,
    JiraProjectLink,
    JiraTaskLink,
    Membership,
    Organization,
    Task,
    User,
)


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
    # Accept-Language: ru — иначе локаль по умолчанию (az) даёт категории
    # «по умолчанию» на азербайджанском, а тесты этого файла написаны и
    # читаются по-русски.
    client.post(
        "/api/auth/register",
        json={
            "name": "Alex",
            "email": "alex@example.com",
            "password": "s3cret-pass",
            "company_name": "Acme",
        },
        headers={"Accept-Language": "ru"},
    )
    return client


@pytest.fixture
def org(db, authed) -> Organization:
    user_id = authed.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == uuid.UUID(user_id)))
    return db.get(Organization, membership.org_id)


@pytest.fixture
def user(db, authed) -> User:
    return db.scalar(select(User).where(User.email == "alex@example.com"))


def _connect(authed):
    return authed.put(
        "/api/jira/credential",
        json={
            "base_url": "https://acme.atlassian.net",
            "email": "bot@acme.example",
            "api_token": "secret-token",
        },
    )


def _issue(key, *, summary, issuetype="Task", status="To Do", category="new", **extra):
    fields = {
        "summary": summary,
        "description": None,
        "status": {"name": status, "statusCategory": {"key": category}},
        "priority": {"name": "Medium"},
        "duedate": None,
        "created": "2026-03-02T09:00:00.000+0400",
        "issuetype": {"name": issuetype},
        **extra,
    }
    return {"key": key, "fields": fields}


def _recorded_client(**kwargs) -> RecordedJiraClient:
    return RecordedJiraClient(
        projects=[{"key": "PROJ", "id": "10000", "name": "Демо проект"}],
        **kwargs,
    )


def _patch_client(monkeypatch, recorded: RecordedJiraClient) -> None:
    monkeypatch.setattr("app.api.jira_routes.client_for", lambda db, org: recorded)


# --- подключение --------------------------------------------------------------


def test_the_token_is_stored_encrypted_and_never_returned(authed, db, org):
    response = _connect(authed)

    assert response.status_code == 200
    body = response.json()
    assert "api_token" not in body
    assert body == {
        "base_url": "https://acme.atlassian.net",
        "email": "bot@acme.example",
        "configured": True,
    }

    row = db.scalar(select(JiraConnection).where(JiraConnection.org_id == org.id))
    assert "secret-token" not in row.encrypted_token
    assert decrypt(row.encrypted_token) == "secret-token"

    read = authed.get("/api/jira/credential").json()
    assert read == body


def test_without_a_connection_the_credential_read_says_so(authed):
    assert authed.get("/api/jira/credential").json() == {
        "base_url": "",
        "email": "",
        "configured": False,
    }


def test_the_address_can_be_changed_without_retyping_the_token(authed, db, org):
    _connect(authed)
    authed.put(
        "/api/jira/credential",
        json={
            "base_url": "https://acme2.atlassian.net",
            "email": "bot@acme.example",
            "api_token": "",
        },
    )

    row = db.scalar(select(JiraConnection).where(JiraConnection.org_id == org.id))
    assert row.base_url == "https://acme2.atlassian.net"
    assert decrypt(row.encrypted_token) == "secret-token"


def test_the_first_connection_needs_a_token(authed):
    response = authed.put(
        "/api/jira/credential",
        json={"base_url": "https://acme.atlassian.net", "email": "bot@acme.example", "api_token": ""},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "jira_token_required"


def test_disconnect_removes_the_credential(authed, db, org):
    _connect(authed)
    assert authed.delete("/api/jira/credential").status_code == 204
    assert db.scalar(select(JiraConnection).where(JiraConnection.org_id == org.id)) is None
    assert authed.get("/api/jira/credential").json()["configured"] is False


def test_only_the_owner_manages_the_connection(authed, db):
    user_id = authed.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == uuid.UUID(user_id)))
    membership.role = "editor"
    db.flush()

    assert authed.get("/api/jira/credential").status_code == 403
    assert _connect(authed).status_code == 403


# --- список проектов Jira ------------------------------------------------------


def test_listing_jira_projects_without_a_connection_is_a_plain_refusal(authed):
    response = authed.get("/api/jira/projects")
    assert response.status_code == 409
    assert response.json()["detail"] == "jira_not_configured"


def test_listing_jira_projects(authed, monkeypatch):
    _connect(authed)
    _patch_client(monkeypatch, _recorded_client())

    response = authed.get("/api/jira/projects")
    assert response.status_code == 200
    assert response.json() == [{"key": "PROJ", "name": "Демо проект"}]


# --- импорт --------------------------------------------------------------------


_EPIC = _issue("PROJ-1", summary="Запуск сайта", issuetype="Epic")
_TASK_IN_EPIC = _issue(
    "PROJ-2",
    summary="Логотип",
    status="In Progress",
    category="indeterminate",
    parent={"key": "PROJ-1"},
)
_TASK_NO_EPIC = _issue("PROJ-3", summary="Разобрать бэклог", status="To Do", category="new")
_TASK_DONE = _issue(
    "PROJ-4", summary="Домен куплен", status="Done", category="done", parent={"key": "PROJ-1"}
)


def test_import_creates_a_project_with_categories_and_tasks(authed, db, org, user, monkeypatch):
    _connect(authed)
    _patch_client(
        monkeypatch,
        _recorded_client(issues=[_EPIC, _TASK_IN_EPIC, _TASK_NO_EPIC, _TASK_DONE]),
    )

    response = authed.post(
        "/api/jira/import", json={"jira_project_key": "PROJ", "name": "Импортированный проект"}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["created_categories"] == 2  # эпик + категория по умолчанию
    assert body["created_tasks"] == 3

    project_id = uuid.UUID(body["project_id"])
    categories = db.scalars(select(Category).where(Category.project_id == project_id)).all()
    assert {c.name for c in categories} == {"Запуск сайта", "Без эпика"}

    tasks = db.scalars(select(Task).where(Task.project_id == project_id)).all()
    by_name = {t.name: t for t in tasks}
    assert by_name["[PROJ-2] Логотип"].status == "in_progress"
    assert by_name["[PROJ-2] Логотип"].progress_pct == 50
    assert by_name["[PROJ-4] Домен куплен"].status == "done"
    assert by_name["[PROJ-4] Домен куплен"].progress_pct == 100
    assert by_name["[PROJ-3] Разобрать бэклог"].status == "planned"

    epic_category = next(c for c in categories if c.name == "Запуск сайта")
    default_category = next(c for c in categories if c.name == "Без эпика")
    assert by_name["[PROJ-2] Логотип"].category_id == epic_category.id
    assert by_name["[PROJ-4] Домен куплен"].category_id == epic_category.id
    assert by_name["[PROJ-3] Разобрать бэклог"].category_id == default_category.id

    # Привязки заведены — без них повторная синхронизация не узнала бы,
    # что эти строки уже существуют.
    project_link = db.scalar(select(JiraProjectLink).where(JiraProjectLink.project_id == project_id))
    assert project_link.jira_project_key == "PROJ"
    assert project_link.last_synced_at is not None
    assert db.scalars(
        select(JiraCategoryLink).where(JiraCategoryLink.project_id == project_id)
    ).all()
    assert (
        len(db.scalars(select(JiraTaskLink).where(JiraTaskLink.project_id == project_id)).all())
        == 3
    )

    # Всё заведено одной пачкой — «Отменить» одной кнопкой откатывает импорт
    # целиком.
    undo = authed.get(f"/api/projects/{project_id}")
    assert undo.json()["undoable"] is not None


def test_import_without_a_connection_is_a_plain_refusal(authed):
    response = authed.post(
        "/api/jira/import", json={"jira_project_key": "PROJ", "name": "Проект"}
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "jira_not_configured"


def test_a_scoped_editor_cannot_import(authed, db):
    user_id = authed.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == uuid.UUID(user_id)))
    membership.role = "editor"
    membership.project_scoped = True
    db.flush()

    response = authed.post(
        "/api/jira/import", json={"jira_project_key": "PROJ", "name": "Проект"}
    )
    assert response.status_code == 403


# --- синхронизация ---------------------------------------------------------------


def test_syncing_an_unlinked_project_is_a_plain_refusal(authed):
    project = authed.post("/api/projects", json={"name": "Обычный проект"}).json()
    response = authed.post(f"/api/projects/{project['id']}/jira/sync")
    assert response.status_code == 409
    assert response.json()["detail"] == "jira_not_linked"


def test_sync_updates_existing_rows_and_adds_new_ones(authed, db, org, user, monkeypatch):
    _connect(authed)
    _patch_client(monkeypatch, _recorded_client(issues=[_EPIC, _TASK_IN_EPIC]))
    imported = authed.post(
        "/api/jira/import", json={"jira_project_key": "PROJ", "name": "Проект"}
    ).json()
    project_id = imported["project_id"]

    # Второй прогон: PROJ-2 закрыт, PROJ-3 — новая задача без эпика.
    task_done = _issue(
        "PROJ-2",
        summary="Логотип",
        status="Done",
        category="done",
        parent={"key": "PROJ-1"},
    )
    _patch_client(monkeypatch, _recorded_client(issues=[_EPIC, task_done, _TASK_NO_EPIC]))

    response = authed.post(f"/api/projects/{project_id}/jira/sync")
    assert response.status_code == 201
    body = response.json()
    assert body["created_tasks"] == 1
    assert body["updated_tasks"] == 1
    assert body["created_categories"] == 1  # категория по умолчанию — только теперь

    tasks = db.scalars(select(Task).where(Task.project_id == uuid.UUID(project_id))).all()
    by_name = {t.name: t for t in tasks}
    assert by_name["[PROJ-2] Логотип"].status == "done"
    assert by_name["[PROJ-2] Логотип"].progress_pct == 100
    assert "[PROJ-3] Разобрать бэклог" in by_name

    link = db.scalar(select(JiraProjectLink).where(JiraProjectLink.project_id == uuid.UUID(project_id)))
    assert link.last_synced_at is not None


def test_sync_does_not_duplicate_a_row_that_has_not_changed(authed, monkeypatch):
    _connect(authed)
    _patch_client(monkeypatch, _recorded_client(issues=[_EPIC, _TASK_IN_EPIC]))
    imported = authed.post(
        "/api/jira/import", json={"jira_project_key": "PROJ", "name": "Проект"}
    ).json()
    project_id = imported["project_id"]

    _patch_client(monkeypatch, _recorded_client(issues=[_EPIC, _TASK_IN_EPIC]))
    response = authed.post(f"/api/projects/{project_id}/jira/sync")
    body = response.json()
    assert body == {
        "batch_id": body["batch_id"],
        "created_categories": 0,
        "created_tasks": 0,
        "updated_tasks": 0,
    }


def test_sync_does_not_resurrect_a_task_deleted_locally(authed, db, monkeypatch):
    _connect(authed)
    _patch_client(monkeypatch, _recorded_client(issues=[_EPIC, _TASK_IN_EPIC]))
    imported = authed.post(
        "/api/jira/import", json={"jira_project_key": "PROJ", "name": "Проект"}
    ).json()
    project_id = imported["project_id"]

    task_id = db.scalar(
        select(Task.id).where(Task.project_id == uuid.UUID(project_id), Task.name.like("%Логотип%"))
    )
    delete_response = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "delete_task", "task_id": str(task_id)}},
    )
    assert delete_response.status_code == 201

    _patch_client(monkeypatch, _recorded_client(issues=[_EPIC, _TASK_IN_EPIC]))
    response = authed.post(f"/api/projects/{project_id}/jira/sync")
    body = response.json()
    assert body["created_tasks"] == 0
    assert body["updated_tasks"] == 0
    tasks = db.scalars(select(Task).where(Task.project_id == uuid.UUID(project_id))).all()
    assert all("Логотип" not in t.name for t in tasks)


def test_read_link_status(authed, monkeypatch):
    project = authed.post("/api/projects", json={"name": "Обычный"}).json()
    assert authed.get(f"/api/projects/{project['id']}/jira").json() == {
        "linked": False,
        "jira_project_key": None,
        "jql": None,
        "last_synced_at": None,
    }

    _connect(authed)
    _patch_client(monkeypatch, _recorded_client(issues=[_EPIC]))
    imported = authed.post(
        "/api/jira/import", json={"jira_project_key": "PROJ", "name": "Из Jira"}
    ).json()

    status = authed.get(f"/api/projects/{imported['project_id']}/jira").json()
    assert status["linked"] is True
    assert status["jira_project_key"] == "PROJ"
    assert status["last_synced_at"] is not None


def test_a_viewer_cannot_trigger_a_sync(authed, db, monkeypatch):
    _connect(authed)
    _patch_client(monkeypatch, _recorded_client(issues=[_EPIC]))
    imported = authed.post(
        "/api/jira/import", json={"jira_project_key": "PROJ", "name": "Из Jira"}
    ).json()

    user_id = authed.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == uuid.UUID(user_id)))
    membership.role = "viewer"
    db.flush()

    response = authed.post(f"/api/projects/{imported['project_id']}/jira/sync")
    assert response.status_code == 403
