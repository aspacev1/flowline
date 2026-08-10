import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import get_db
from app.main import app


@pytest.fixture
def client(db):
    """TestClient, у которого get_db переопределён на сессию фикстуры `db`.

    Переопределение отдаёт ровно ту же сессию и не делает commit — иначе
    внешняя транзакция фикстуры `db` закрылась бы раньше времени и
    изоляция между тестами исчезла бы (см. tests/conftest.py). Тот же
    паттерн, что и в tests/test_auth.py.
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
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    return client


def test_creating_a_project_derives_a_slug_from_the_name(authed):
    response = authed.post("/api/projects", json={"name": "Şəhər Layihəsi"})
    assert response.status_code == 201
    assert response.json()["slug"] == "seher-layihesi"


def test_project_listing_shows_only_own_organization(authed):
    authed.post("/api/projects", json={"name": "Redesign"})
    response = authed.get("/api/projects")
    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["Redesign"]


def test_mutation_creates_a_task_and_returns_the_computed_end_date(authed):
    project_id = authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]
    category_id = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "create_category", "name": "Design", "color": "#3b82f6"}},
    ).json()["op"]["category_id"]

    authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category_id,
                "name": "Logo",
                "start_date": "2026-03-06",
                "duration_days": 3,
            }
        },
    )

    state = authed.get(f"/api/projects/{project_id}").json()
    task = state["tasks"][0]
    assert task["start_date"] == "2026-03-06"
    # пятница плюс три рабочих дня: пт, пн, вт
    assert task["end_date"] == "2026-03-10"


def test_mutation_requires_authentication(client):
    response = client.post(
        "/api/projects/00000000-0000-0000-0000-000000000000/mutations",
        json={"op": {"type": "create_category", "name": "X", "color": "#000000"}},
    )
    assert response.status_code == 401


def test_mutation_on_a_foreign_project_returns_404(authed, db):
    from app.models import Organization, Project

    other_org = Organization(name="Other", slug="other")
    db.add(other_org)
    db.flush()
    foreign = Project(org_id=other_org.id, name="Secret", slug="secret")
    db.add(foreign)
    db.flush()

    response = authed.post(
        f"/api/projects/{foreign.id}/mutations",
        json={"op": {"type": "create_category", "name": "X", "color": "#000000"}},
    )
    assert response.status_code == 404


def test_get_project_on_a_foreign_project_returns_404(authed, db):
    # Тот же обработчик _load_project, что и у мутаций, но здесь это отдельный
    # маршрут (GET), и до сих пор эта ветка не была проверена для него.
    from app.models import Organization, Project

    other_org = Organization(name="Other", slug="other")
    db.add(other_org)
    db.flush()
    foreign = Project(org_id=other_org.id, name="Secret", slug="secret")
    db.add(foreign)
    db.flush()

    response = authed.get(f"/api/projects/{foreign.id}")
    assert response.status_code == 404


def _demote_own_membership(authed, db, role: str) -> None:
    """Меняет роль зарегистрированного пользователя напрямую в записи
    членства, минуя регистрацию (у неё роль всегда owner)."""
    from app.models import Membership

    user_id = authed.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
    membership.role = role
    db.flush()


def test_role_without_project_read_permission_gets_404_on_both_read_routes(authed, db):
    # access._MATRIX: client входит в _NEEDS_GRANT и без выданного доступа к
    # проекту не имеет даже PROJECT_READ — маршруты чтения обязаны спросить
    # об этом can(), а не пускать любого члена организации.
    project_id = authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]

    _demote_own_membership(authed, db, "client")

    # чужой проект неотличим от несуществующего — тот же принцип применяется
    # и к «есть проект, но роль не имеет права его читать»: 404, а не 403.
    assert authed.get(f"/api/projects/{project_id}").status_code == 404
    assert authed.get("/api/projects").status_code == 404


def test_role_without_read_internal_note_permission_does_not_see_it_in_get_project(
    authed, db, monkeypatch
):
    # Ни одна из ролей, доступных сегодня через HTTP без грантов на проект
    # (owner/editor с правом записи всегда заодно имеют READ_INTERNAL_NOTE),
    # не воспроизводит «читает проект, но не видит заметку» — этот разрыв
    # появится вместе с приглашениями и ролью client с выданным доступом
    # (план 5). Поэтому здесь can() подменяется точечно только для
    # READ_INTERNAL_NOTE, чтобы проверить именно код маршрута, а не гадать
    # о будущей инфраструктуре грантов.
    import app.api.project_routes as project_routes

    project_id = authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]
    category_id = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "create_category", "name": "Design", "color": "#3b82f6"}},
    ).json()["op"]["category_id"]
    authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category_id,
                "name": "Logo",
                "start_date": "2026-03-06",
                "duration_days": 3,
                "internal_note": "тайный план",
            }
        },
    )

    real_can = project_routes.can

    def fake_can(role, action, *, project_granted=False):
        from app.access import Action

        if action is Action.READ_INTERNAL_NOTE:
            return False
        return real_can(role, action, project_granted=project_granted)

    monkeypatch.setattr(project_routes, "can", fake_can)

    state = authed.get(f"/api/projects/{project_id}").json()
    assert "internal_note" not in state["tasks"][0]


def test_role_without_read_internal_note_permission_does_not_see_it_in_mutation_response(
    authed, monkeypatch
):
    # create_task кладёт internal_note в свой op, а его обратная операция —
    # это голый delete_task без заметки; delete_task — наоборот, у самой
    # операции заметки нет, зато её обратная операция (снимок для undo)
    # несёт полную копию задачи вместе с internal_note. Проверяем оба поля
    # на паре запросов, которая реально их заполняет.
    import app.api.project_routes as project_routes

    project_id = authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]
    category_id = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "create_category", "name": "Design", "color": "#3b82f6"}},
    ).json()["op"]["category_id"]

    real_can = project_routes.can

    def fake_can(role, action, *, project_granted=False):
        from app.access import Action

        if action is Action.READ_INTERNAL_NOTE:
            return False
        return real_can(role, action, project_granted=project_granted)

    monkeypatch.setattr(project_routes, "can", fake_can)

    create_response = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category_id,
                "name": "Logo",
                "start_date": "2026-03-06",
                "duration_days": 3,
                "internal_note": "тайный план",
            }
        },
    )
    created = create_response.json()
    assert "internal_note" not in created["op"]
    task_id = created["op"]["task_id"]

    delete_response = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "delete_task", "task_id": task_id}},
    )
    deleted = delete_response.json()
    assert "internal_note" not in deleted["inverse"]


def _project_with_task(authed) -> tuple[str, str, str]:
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
            }
        },
    ).json()["op"]["task_id"]
    return project_id, category_id, task_id


def test_naming_a_task_of_another_project_is_reported_as_not_found(authed):
    # Раньше маршрут расплющивал оба класса отказа в 422 с русской прозой:
    # обращение к задаче чужой организации выглядело ошибкой валидации.
    own_project_id, _, _ = _project_with_task(authed)
    other_project_id, _, foreign_task_id = _project_with_task(authed)
    assert other_project_id != own_project_id

    response = authed.post(
        f"/api/projects/{own_project_id}/mutations",
        json={"op": {"type": "move_task", "task_id": foreign_task_id,
                     "start_date": "2026-03-11"}},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "task_not_found"


def test_a_refused_operation_answers_with_a_stable_machine_code(authed):
    project_id, category_id, _ = _project_with_task(authed)

    response = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "delete_category", "category_id": category_id}},
    )
    assert response.status_code == 422
    # Код, а не переводимая проза: тексты сообщений составляет клиент.
    assert response.json()["detail"] == "category_not_empty"
