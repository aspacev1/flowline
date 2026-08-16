"""Маршруты коммерческого предложения: смета, реплики, перенос в план."""

import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app


@pytest.fixture
def client(db):
    """Тот же паттерн, что в tests/test_comment_api.py: get_db отдаёт сессию
    фикстуры `db`, и внешняя транзакция откатывает всё после теста."""

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


def _category_id(authed, project_id: str, name: str = "Дизайн") -> str:
    response = authed.post(
        f"/api/projects/{project_id}/proposal/categories", json={"name": name}
    )
    assert response.status_code == 201
    return response.json()["id"]


def _task_id(authed, project_id: str, category_id: str, name: str = "Логотип") -> str:
    response = authed.post(
        f"/api/projects/{project_id}/proposal/categories/{category_id}/tasks",
        json={"name": name},
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_untouched_project_answers_with_default_proposal(authed, project_id):
    """Проект без сметы отвечает значениями по умолчанию, а не 404: клиент не
    различает «не заводили» и «завели пустым», и различие это ему ни к чему."""
    state = authed.get(f"/api/projects/{project_id}/proposal").json()

    assert state == {
        "effort_unit": "days",
        "hours_per_day": 8,
        "tax_rate_pct": 0.0,
        "currency": "USD",
        "categories": [],
    }


def test_estimate_row_carries_role_effort_and_rate(authed, project_id):
    category_id = _category_id(authed, project_id)
    task_id = _task_id(authed, project_id, category_id)

    patched = authed.patch(
        f"/api/projects/{project_id}/proposal/tasks/{task_id}",
        json={
            "role": "Дизайнер",
            "effort": 2.5,
            "rate": 400,
            "description": "Знак и логотип",
            "details": "Три варианта, два раунда правок",
            "notes": "Шрифт покупает клиент",
            "risks": "Правки затянутся",
            "assumptions": "Брендбук уже есть",
        },
    )
    assert patched.status_code == 200

    state = authed.get(f"/api/projects/{project_id}/proposal").json()
    row = state["categories"][0]["tasks"][0]
    assert row["role"] == "Дизайнер"
    assert row["effort"] == 2.5
    assert row["rate"] == 400.0
    assert row["details"] == "Три варианта, два раунда правок"
    assert row["risks"] == "Правки затянутся"
    # Цены в ответе нет намеренно: она равна effort × rate, и хранимая копия
    # разъехалась бы с сомножителями.
    assert "price" not in row


def test_settings_patch_changes_only_named_fields(authed, project_id):
    response = authed.patch(
        f"/api/projects/{project_id}/proposal",
        json={"effort_unit": "hours", "tax_rate_pct": 18, "currency": "eur"},
    )
    assert response.status_code == 200

    state = authed.get(f"/api/projects/{project_id}/proposal").json()
    assert state["effort_unit"] == "hours"
    assert state["tax_rate_pct"] == 18.0
    # Код валюты нормализуется к верхнему регистру: он код, а не текст.
    assert state["currency"] == "EUR"
    # Не названное в запросе поле не тронуто.
    assert state["hours_per_day"] == 8


def test_row_comments_are_signed_and_counted(authed, project_id):
    category_id = _category_id(authed, project_id)
    task_id = _task_id(authed, project_id, category_id)

    posted = authed.post(
        f"/api/projects/{project_id}/proposal/tasks/{task_id}/comments",
        json={"body": "  Ставку согласовали  "},
    )
    assert posted.status_code == 201
    assert posted.json()["body"] == "Ставку согласовали"
    assert posted.json()["author"] == {"name": "Alex", "guest": False}

    thread = authed.get(
        f"/api/projects/{project_id}/proposal/tasks/{task_id}/comments"
    ).json()
    assert [comment["body"] for comment in thread] == ["Ставку согласовали"]

    state = authed.get(f"/api/projects/{project_id}/proposal").json()
    assert state["categories"][0]["tasks"][0]["comment_count"] == 1


def test_row_of_another_project_is_unreachable(authed, project_id):
    """Строка чужой сметы неотличима от несуществующей — тем же принципом,
    что и задачи в маршрутах мутаций."""
    other_id = authed.post("/api/projects", json={"name": "Other"}).json()["id"]
    category_id = _category_id(authed, other_id)
    stranger = _task_id(authed, other_id, category_id)

    response = authed.patch(
        f"/api/projects/{project_id}/proposal/tasks/{stranger}", json={"role": "нет"}
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "proposal_task_not_found"


def test_deleting_a_category_takes_its_rows_along(authed, project_id):
    category_id = _category_id(authed, project_id)
    _task_id(authed, project_id, category_id)

    response = authed.delete(
        f"/api/projects/{project_id}/proposal/categories/{category_id}"
    )
    assert response.status_code == 204
    assert authed.get(f"/api/projects/{project_id}/proposal").json()["categories"] == []


def test_push_to_plan_turns_rows_into_tasks_as_one_batch(authed, project_id):
    """Перенос: раздел — категорией, строка — задачей, часы — днями вверх."""
    authed.patch(
        f"/api/projects/{project_id}/proposal",
        json={"effort_unit": "hours", "hours_per_day": 8},
    )
    category_id = _category_id(authed, project_id, name="Дизайн")
    logo = _task_id(authed, project_id, category_id, name="Логотип")
    authed.patch(
        f"/api/projects/{project_id}/proposal/tasks/{logo}",
        json={"effort": 20, "description": "Знак"},
    )
    _task_id(authed, project_id, category_id, name="Гайдлайн")

    response = authed.post(f"/api/projects/{project_id}/proposal/push-to-plan")
    assert response.status_code == 201
    assert response.json() == {"created_tasks": 2}

    state = authed.get(f"/api/projects/{project_id}").json()
    assert [category["name"] for category in state["categories"]] == ["Дизайн"]
    by_name = {task["name"]: task for task in state["tasks"]}
    # 20 часов при восьмичасовом дне — три календарных дня, вверх: полдня
    # работы всё равно занимают день в ленте.
    assert by_name["Логотип"]["duration_days"] == 3
    assert by_name["Логотип"]["description"] == "Знак"
    # Нулевая оценка — день: задач короче дня у диаграммы нет.
    assert by_name["Гайдлайн"]["duration_days"] == 1
    # Пачка отменяется одной кнопкой: у всех ревизий общий batch_id.
    revisions = authed.get(f"/api/projects/{project_id}/revisions").json()
    batches = {entry["batch_id"] for entry in revisions}
    assert len(batches) == 1 and batches != {None}


def test_second_push_reuses_the_plan_category_by_name(authed, project_id):
    category_id = _category_id(authed, project_id, name="Дизайн")
    _task_id(authed, project_id, category_id, name="Логотип")
    authed.post(f"/api/projects/{project_id}/proposal/push-to-plan")

    _task_id(authed, project_id, category_id, name="Гайдлайн")
    authed.post(f"/api/projects/{project_id}/proposal/push-to-plan")

    state = authed.get(f"/api/projects/{project_id}").json()
    # «Дизайн» один: повторный перенос не плодит одноимённых категорий.
    assert [category["name"] for category in state["categories"]] == ["Дизайн"]


def test_empty_proposal_refuses_to_push(authed, project_id):
    response = authed.post(f"/api/projects/{project_id}/proposal/push-to-plan")
    assert response.status_code == 422
    assert response.json()["detail"] == "proposal_empty"
