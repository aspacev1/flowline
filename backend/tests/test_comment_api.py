import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app


@pytest.fixture
def client(db):
    """TestClient, у которого get_db переопределён на сессию фикстуры `db`.

    Тот же паттерн, что и в tests/test_project_api.py: переопределение отдаёт
    ровно ту же сессию и не делает commit, иначе внешняя транзакция фикстуры
    закрылась бы раньше времени.
    """

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
        json={
            "name": "Alex",
            "email": "alex@example.com",
            "password": "s3cret-pass",
            "company_name": "Acme",
        },
    )
    return client


@pytest.fixture
def project_id(authed):
    return authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]


def _task_id(authed, project_id: str) -> str:
    category = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "create_category", "name": "Дизайн", "color": "#3b82f6"}},
    ).json()["op"]["category_id"]
    return authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category,
                "name": "Логотип",
                "start_date": "2026-03-04",
                "duration_days": 5,
            }
        },
    ).json()["op"]["task_id"]


def test_posting_a_comment_returns_it_signed_by_its_author(authed, project_id):
    response = authed.post(f"/api/projects/{project_id}/comments", json={"body": "Согласовано"})

    assert response.status_code == 201
    body = response.json()
    assert body["body"] == "Согласовано"
    assert body["author"] == {"name": "Alex", "guest": False}
    assert body["task_id"] is None


def test_the_task_thread_is_narrower_than_the_project_thread(authed, project_id):
    """Карточка задачи показывает разговор о ней. Лента проекта — весь его
    разговор, включая реплики к строкам: второе место, куда надо заглянуть,
    чтобы не пропустить сказанное, здесь заводить не за чем."""
    task_id = _task_id(authed, project_id)
    authed.post(f"/api/projects/{project_id}/comments", json={"body": "о проекте"})
    authed.post(
        f"/api/projects/{project_id}/comments", json={"body": "о задаче", "task_id": task_id}
    )

    of_task = authed.get(f"/api/projects/{project_id}/comments?task_id={task_id}").json()
    of_project = authed.get(f"/api/projects/{project_id}/comments").json()

    assert [c["body"] for c in of_task] == ["о задаче"]
    assert [c["body"] for c in of_project] == ["о проекте", "о задаче"]


def test_empty_comment_is_refused_with_a_machine_code(authed, project_id):
    response = authed.post(f"/api/projects/{project_id}/comments", json={"body": "   "})

    assert response.status_code == 422
    assert response.json()["detail"] == "comment_empty"


def test_comment_on_a_task_of_another_project_is_not_found(authed, project_id):
    other = authed.post("/api/projects", json={"name": "Other"}).json()["id"]
    stranger = _task_id(authed, other)

    response = authed.post(
        f"/api/projects/{project_id}/comments", json={"body": "сюда", "task_id": stranger}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "task_not_found"


def test_comments_of_another_organization_are_not_reachable(authed, db):
    """Чужой проект неотличим от несуществующего — тем же принципом, что и в
    остальных маршрутах проекта."""
    from app.models import Organization, Project

    other_org = Organization(name="Globex", slug="globex")
    db.add(other_org)
    db.flush()
    stranger = Project(org_id=other_org.id, name="Secret", slug="secret")
    db.add(stranger)
    db.flush()

    assert authed.get(f"/api/projects/{stranger.id}/comments").status_code == 404
    assert (
        authed.post(f"/api/projects/{stranger.id}/comments", json={"body": "?"}).status_code == 404
    )


def test_comments_require_a_session(authed, project_id):
    """Гостя по публичной ссылке ещё нет: без сессии лента закрыта."""
    anonymous = TestClient(app)

    assert anonymous.get(f"/api/projects/{project_id}/comments").status_code == 401
    assert (
        anonymous.post(f"/api/projects/{project_id}/comments", json={"body": "?"}).status_code
        == 401
    )


def test_a_viewer_may_comment_without_the_right_to_change_the_plan(authed, project_id, db):
    """Матрица прав уже говорит, что viewer комментирует, не имея права
    писать в план. Маршрут обязан спрашивать её, а не список ролей у себя."""
    from sqlalchemy import select

    from app.models import Membership

    membership = db.scalar(select(Membership))
    membership.role = "viewer"
    db.flush()

    assert (
        authed.post(f"/api/projects/{project_id}/comments", json={"body": "вопрос"}).status_code
        == 201
    )
    # Тот же человек по той же матрице план менять не может — иначе тест выше
    # проходил бы и на маршруте, который прав вообще не спрашивает.
    assert (
        authed.post(
            f"/api/projects/{project_id}/mutations",
            json={"op": {"type": "create_category", "name": "Дизайн", "color": "#3b82f6"}},
        ).status_code
        == 403
    )
