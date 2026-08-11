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


def test_project_listing_shows_only_own_organization(authed, db):
    """В тесте обязана существовать вторая организация со своим проектом.

    Без неё утверждение проходило бы точно так же, даже если убрать из
    маршрута фильтр по организации, — то есть не проверяло бы ничего.
    """
    from app.models import Organization, Project

    authed.post("/api/projects", json={"name": "Redesign"})

    other_org = Organization(name="Globex", slug="globex")
    db.add(other_org)
    db.flush()
    db.add(Project(org_id=other_org.id, name="Secret", slug="secret"))
    db.flush()

    response = authed.get("/api/projects")
    assert response.status_code == 200
    names = [item["name"] for item in response.json()]
    assert names == ["Redesign"]
    assert "Secret" not in names


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
    #
    # Подменяется can() внутри access: решение о видимости заметки живёт там,
    # а маршрут только зовёт access.visible_op.
    import app.access as access

    project_id = authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]
    category_id = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "create_category", "name": "Design", "color": "#3b82f6"}},
    ).json()["op"]["category_id"]

    real_can = access.can

    def fake_can(role, action, *, project_granted=False):
        from app.access import Action

        if action is Action.READ_INTERNAL_NOTE:
            return False
        return real_can(role, action, project_granted=project_granted)

    monkeypatch.setattr(access, "can", fake_can)

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


def test_an_over_long_name_is_refused_before_it_reaches_the_column(authed):
    # tasks.name — varchar(300): без границы в схеме строка длиннее приезжала
    # в базу и возвращалась пятисоткой на ошибке усечения.
    project_id, category_id, _ = _project_with_task(authed)

    response = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category_id,
                "name": "L" * 301,
                "start_date": "2026-03-06",
                "duration_days": 3,
            }
        },
    )
    assert response.status_code == 422


def test_an_unknown_criticality_is_refused(authed):
    project_id, category_id, _ = _project_with_task(authed)

    response = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category_id,
                "name": "Logo",
                "start_date": "2026-03-06",
                "duration_days": 3,
                "criticality": "апокалиптическая",
            }
        },
    )
    assert response.status_code == 422


@pytest.mark.parametrize("progress", [-1, 101])
def test_progress_outside_the_percentage_range_is_refused(authed, progress):
    project_id, category_id, _ = _project_with_task(authed)

    response = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category_id,
                "name": "Logo",
                "start_date": "2026-03-06",
                "duration_days": 3,
                "progress_pct": progress,
            }
        },
    )
    assert response.status_code == 422


def test_a_client_supplied_task_id_never_reaches_the_database(authed, db):
    # task_id существует ради отмены удаления: он восстанавливает строку под
    # прежним идентификатором. По проводу его принимать нельзя — назначение
    # идентификаторов перестаёт быть делом сервера, а совпадение с уже
    # существующим id превращается в IntegrityError и пятисотку.
    from app.models import Task

    project_id, category_id, _ = _project_with_task(authed)
    chosen = "11111111-1111-1111-1111-111111111111"

    response = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category_id,
                "name": "Logo",
                "start_date": "2026-03-06",
                "duration_days": 3,
                "task_id": chosen,
            }
        },
    )
    assert response.status_code == 422
    assert db.get(Task, chosen) is None


def test_a_client_supplied_position_never_reaches_the_database(authed, db):
    from app.models import Task

    project_id, category_id, _ = _project_with_task(authed)

    response = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category_id,
                "name": "Logo",
                "start_date": "2026-03-06",
                "duration_days": 3,
                "position": -5,
            }
        },
    )
    assert response.status_code == 422
    assert db.scalar(select(Task).where(Task.position == -5)) is None


def test_project_slug_collision_at_insert_time_retries_instead_of_failing(authed, monkeypatch):
    """Тот же тест гонки, что у слага организации, — теперь и для проекта.

    Раньше маршрут делал проверку-и-вставку без обработки IntegrityError: два
    одновременных создания с одинаковым названием в одной организации давали
    пятисотку. Симулируем устаревшую проверку: первый кандидат — уже занятый
    слаг, вставка обязана упасть и повториться с новым суффиксом.
    """
    import app.slugs as slugs

    authed.post("/api/projects", json={"name": "Redesign"})

    original = slugs._candidate
    calls = {"n": 0}

    def flaky(name, *, forced, is_taken, fallback):
        calls["n"] += 1
        if calls["n"] == 1:
            return "redesign"  # уже занято — вставка упадёт на уникальном индексе
        return original(name, forced=True, is_taken=is_taken, fallback=fallback)

    monkeypatch.setattr(slugs, "_candidate", flaky)

    response = authed.post("/api/projects", json={"name": "Redesign"})
    assert response.status_code == 201
    assert response.json()["slug"] != "redesign"
    assert calls["n"] >= 2


def test_two_projects_with_the_same_name_get_distinct_slugs(authed):
    first = authed.post("/api/projects", json={"name": "Redesign"}).json()
    second = authed.post("/api/projects", json={"name": "Redesign"}).json()
    assert first["slug"] == "redesign"
    assert second["slug"].startswith("redesign-")


def test_project_state_carries_assignees_dependencies_and_calendar(authed, db):
    project_id = authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]
    category_id = authed.post(f"/api/projects/{project_id}/mutations", json={"op": {
        "type": "create_category", "name": "Design", "color": "#3b82f6"}}).json()["op"]["category_id"]
    first = authed.post(f"/api/projects/{project_id}/mutations", json={"op": {
        "type": "create_task", "category_id": category_id, "name": "A",
        "start_date": "2026-03-04", "duration_days": 2}}).json()["op"]["task_id"]
    second = authed.post(f"/api/projects/{project_id}/mutations", json={"op": {
        "type": "create_task", "category_id": category_id, "name": "B",
        "start_date": "2026-03-10", "duration_days": 2}}).json()["op"]["task_id"]
    authed.post(f"/api/projects/{project_id}/mutations", json={"op": {
        "type": "add_dependency", "from_task_id": first, "to_task_id": second}})

    me = authed.get("/api/auth/me").json()
    authed.post(f"/api/projects/{project_id}/mutations", json={"op": {
        "type": "assign_user", "task_id": first, "user_id": me["id"]}})

    state = authed.get(f"/api/projects/{project_id}").json()

    assert state["dependencies"] == [{"from_task_id": first, "to_task_id": second}]
    task = next(t for t in state["tasks"] if t["id"] == first)
    assert task["assignee_ids"] == [me["id"]]
    assert state["calendar"]["working_days"] == 31        # пн–пт
    assert state["calendar"]["holidays"] == []
    assert state["settings"]["shift_threshold_days"] == 2


def test_project_state_reports_the_deadline_and_project_end(authed):
    project_id = authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]
    state = authed.get(f"/api/projects/{project_id}").json()
    assert state["deadline"] is None
    assert state["project_end"] is None


def test_project_end_is_the_latest_task_end(authed):
    project_id, category_id, _ = _project_with_task(authed)  # 2026-03-06 + 3 → 2026-03-10
    authed.post(f"/api/projects/{project_id}/mutations", json={"op": {
        "type": "create_task", "category_id": category_id, "name": "Later",
        "start_date": "2026-03-16", "duration_days": 2}})

    state = authed.get(f"/api/projects/{project_id}").json()
    # пн 16 + 2 рабочих дня = вт 17 — позже, чем 10 марта у первой задачи
    assert state["project_end"] == "2026-03-17"


def test_a_task_with_no_assignees_reports_an_empty_list(authed):
    project_id, _, task_id = _project_with_task(authed)
    state = authed.get(f"/api/projects/{project_id}").json()
    assert next(t for t in state["tasks"] if t["id"] == task_id)["assignee_ids"] == []


def test_the_calendar_reports_the_project_exceptions(authed, db):
    """Исключения проекта видны интерфейсу до первого клика.

    Он заливает нерабочие дни на шкале и рисует выходные — без этого блока
    ему пришлось бы догадываться о них по маске недели.
    """
    import uuid as uuid_module

    from app.models import Project

    project_id, _, _ = _project_with_task(authed)
    project = db.get(Project, uuid_module.UUID(project_id))
    project.holidays_extra = ["2026-03-09"]
    project.workdays_extra = ["2026-03-07"]
    db.flush()

    calendar = authed.get(f"/api/projects/{project_id}").json()["calendar"]
    assert calendar["holidays"] == ["2026-03-09"]
    assert calendar["extra_workdays"] == ["2026-03-07"]


def test_reading_a_project_with_no_working_days_explains_itself(authed, db):
    """Настройка приходит от человека — значит уронить чтение может человек.

    Вырожденная маска раньше поднимала голый ValueError из end_date и
    отвечала пятисоткой: проект переставал читаться без объяснения.
    """
    import uuid

    from app.models import Project

    project_id = authed.post("/api/projects", json={"name": "Broken"}).json()["id"]
    category_id = authed.post(f"/api/projects/{project_id}/mutations", json={"op": {
        "type": "create_category", "name": "Design", "color": "#3b82f6"}}).json()["op"]["category_id"]
    authed.post(f"/api/projects/{project_id}/mutations", json={"op": {
        "type": "create_task", "category_id": category_id, "name": "A",
        "start_date": "2026-03-04", "duration_days": 2}})

    project = db.get(Project, uuid.UUID(project_id))
    project.working_days = 0
    db.flush()

    response = authed.get(f"/api/projects/{project_id}")
    assert response.status_code == 422
    assert response.json()["detail"] == "calendar_has_no_working_days"


def test_a_calendar_too_short_for_the_duration_is_also_explained(authed, db):
    """Вторая точка отказа календаря отвечает так же — кодом, а не пятисоткой."""
    import uuid

    from app.models import Project

    project_id = authed.post("/api/projects", json={"name": "Narrow"}).json()["id"]
    category_id = authed.post(f"/api/projects/{project_id}/mutations", json={"op": {
        "type": "create_category", "name": "Design", "color": "#3b82f6"}}).json()["op"]["category_id"]
    authed.post(f"/api/projects/{project_id}/mutations", json={"op": {
        "type": "create_task", "category_id": category_id, "name": "A",
        "start_date": "2026-03-06", "duration_days": 2}})

    project = db.get(Project, uuid.UUID(project_id))
    # Единственный рабочий день во всём календаре — тот, с которого задача
    # начинается; на второй день длительности рабочих дней уже не остаётся.
    project.working_days = 0
    project.workdays_extra = ["2026-03-06"]
    db.flush()

    response = authed.get(f"/api/projects/{project_id}")
    assert response.status_code == 422
    assert response.json()["detail"] == "calendar_too_few_working_days"
