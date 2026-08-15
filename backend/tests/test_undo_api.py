"""Отмена по проводу: последнее действие и пачка целиком."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import get_db
from app.main import app
from app.models import Category, Membership, Project, Revision, Task
from app.mutations import CreateCategory, CreateTask, apply_op, last_undoable, undo_batch


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
def project_with_task(authed):
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
                "start_date": "2026-03-02",
                "duration_days": 5,
            }
        },
    ).json()["op"]["task_id"]
    return project_id, category_id, task_id


def _state(authed, project_id):
    return authed.get(f"/api/projects/{project_id}").json()


def test_undo_returns_the_task_to_where_it_was(authed, project_with_task):
    project_id, _, task_id = project_with_task
    authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "move_task", "task_id": task_id, "start_date": "2026-03-09"}},
    )

    response = authed.post(f"/api/projects/{project_id}/undo")

    assert response.status_code == 201
    assert _state(authed, project_id)["tasks"][0]["start_date"] == "2026-03-02"


def test_pressing_undo_twice_steps_two_changes_back(authed, project_with_task):
    """Вторая отмена отменяет предыдущее изменение, а не собственную отмену.

    Без учёта «эта ревизия — отмена вон той» журнал линеен, и вторая запись
    сверху после отмены — она сама: человек, нажавший «Отменить» дважды,
    оказался бы там же, откуда начал.
    """
    project_id, _, task_id = project_with_task
    for day in ("2026-03-09", "2026-03-10"):
        authed.post(
            f"/api/projects/{project_id}/mutations",
            json={"op": {"type": "move_task", "task_id": task_id, "start_date": day}},
        )

    authed.post(f"/api/projects/{project_id}/undo")
    assert _state(authed, project_id)["tasks"][0]["start_date"] == "2026-03-09"

    authed.post(f"/api/projects/{project_id}/undo")
    assert _state(authed, project_id)["tasks"][0]["start_date"] == "2026-03-02"


def test_undo_brings_a_deleted_task_back_with_its_note(authed, project_with_task, db):
    project_id, category_id, _ = project_with_task
    created = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category_id,
                "name": "Черновик",
                "start_date": "2026-03-02",
                "duration_days": 1,
                "internal_note": "тайный план",
            }
        },
    ).json()["op"]["task_id"]
    authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "delete_task", "task_id": created}},
    )

    authed.post(f"/api/projects/{project_id}/undo")

    restored = db.get(Task, uuid.UUID(created))
    assert restored is not None
    # Заметка возвращается вместе с задачей: снимок для отмены хранит её, и
    # видимость решается на выдаче, а не порчей самого журнала.
    assert restored.internal_note == "тайный план"


def test_the_project_state_names_what_undo_will_undo(authed, project_with_task):
    project_id, _, task_id = project_with_task

    undoable = _state(authed, project_id)["undoable"]
    assert undoable["op"]["type"] == "create_task"

    authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "move_task", "task_id": task_id, "start_date": "2026-03-09"}},
    )
    assert _state(authed, project_id)["undoable"]["op"]["type"] == "move_task"

    authed.post(f"/api/projects/{project_id}/undo")
    # Отмена не предлагает отменить саму себя: следующим на очереди стоит
    # создание задачи.
    assert _state(authed, project_id)["undoable"]["op"]["type"] == "create_task"


def test_undo_of_set_status_restores_status_and_progress_together(authed, project_with_task):
    """Отмена снимает и статус, и прогресс, который утащила за собой связка.

    set_status в 'done' дотягивает прогресс до 100; отмена обязана вернуть
    оба значения, а не оставить задачу «запланированной, но готовой на 100%».
    """
    project_id, _, task_id = project_with_task
    authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "set_progress", "task_id": task_id, "progress_pct": 40}},
    )
    authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "set_status", "task_id": task_id, "status": "done"}},
    )
    task = _state(authed, project_id)["tasks"][0]
    assert (task["status"], task["progress_pct"]) == ("done", 100)

    authed.post(f"/api/projects/{project_id}/undo")

    task = _state(authed, project_id)["tasks"][0]
    assert (task["status"], task["progress_pct"]) == ("planned", 40)


def test_an_empty_project_has_nothing_to_undo(authed):
    project_id = authed.post("/api/projects", json={"name": "Пустой"}).json()["id"]

    assert _state(authed, project_id)["undoable"] is None
    assert authed.post(f"/api/projects/{project_id}/undo").status_code == 404


def test_undo_that_breaks_the_threshold_asks_for_a_reason(authed, project_with_task):
    """Отмена — не привилегированное действие.

    Задача уехала с объяснением, потом вернулась на место (возврат к базовому
    плану объяснений не требует). Отмена этого возврата снова уводит её на две
    недели — и обязана спросить причину ровно так же, как это сделал бы
    обычный сдвиг мышью.
    """
    project_id, _, task_id = project_with_task
    authed.post(f"/api/projects/{project_id}/plan/approvals")
    authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {"type": "move_task", "task_id": task_id, "start_date": "2026-03-16"},
            "reason": "подрядчик сорвал срок",
        },
    )
    authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "move_task", "task_id": task_id, "start_date": "2026-03-02"}},
    )

    refused = authed.post(f"/api/projects/{project_id}/undo")
    assert refused.status_code == 409
    assert refused.json()["detail"] == "reason_required"
    assert refused.headers["X-Shift-Deviation-Days"] == "14"

    accepted = authed.post(
        f"/api/projects/{project_id}/undo", json={"reason": "всё-таки сдвигаем"}
    )
    assert accepted.status_code == 201
    assert _state(authed, project_id)["tasks"][0]["start_date"] == "2026-03-16"


def test_undo_of_a_named_revision_goes_through_while_it_is_still_on_top(authed, project_with_task):
    project_id, _, task_id = project_with_task
    moved = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "move_task", "task_id": task_id, "start_date": "2026-03-09"}},
    ).json()

    response = authed.post(
        f"/api/projects/{project_id}/undo", json={"expected_seq": moved["seq"]}
    )

    assert response.status_code == 201
    assert response.json()["undone_seq"] == moved["seq"]
    assert _state(authed, project_id)["tasks"][0]["start_date"] == "2026-03-02"


def test_undo_refuses_when_the_top_of_the_journal_moved_on(authed, project_with_task):
    """Кнопка обещала вернуть свой перенос, а вернула бы чужую правку.

    Между показом «Отменить» и нажатием сосед по проекту успевает применить
    своё изменение. Безномерная отмена сняла бы его — молча и не спросив ни
    того, кто нажал, ни того, чью правку сняли.
    """
    project_id, _, task_id = project_with_task
    mine = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "move_task", "task_id": task_id, "start_date": "2026-03-09"}},
    ).json()
    authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "set_progress", "task_id": task_id, "progress_pct": 40}},
    )

    refused = authed.post(f"/api/projects/{project_id}/undo", json={"expected_seq": mine["seq"]})

    assert refused.status_code == 409
    assert refused.json()["detail"] == "undo_conflict"
    # Ни одной правки отказ не тронул: ни своей, ни чужой.
    task = _state(authed, project_id)["tasks"][0]
    assert (task["start_date"], task["progress_pct"]) == ("2026-03-09", 40)


def test_an_empty_project_refuses_a_named_undo_as_nothing_to_undo(authed):
    """Пустой журнал — это «отменять нечего», а не «не то наверху».

    Разные коды не педантичность: по первому кнопка исчезает, по второму
    интерфейс перечитывает состояние и показывает, что теперь наверху.
    """
    project_id = authed.post("/api/projects", json={"name": "Пустой"}).json()["id"]

    refused = authed.post(f"/api/projects/{project_id}/undo", json={"expected_seq": 1})

    assert refused.status_code == 404
    assert refused.json()["detail"] == "nothing_to_undo"


def test_a_viewer_may_not_undo(authed, db, project_with_task):
    project_id, _, _ = project_with_task
    user_id = authed.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
    membership.role = "viewer"
    db.flush()

    assert authed.post(f"/api/projects/{project_id}/undo").status_code == 403


def test_undo_of_a_foreign_project_is_not_found(authed, db):
    from app.models import Organization

    other = Organization(name="Globex", slug="globex")
    db.add(other)
    db.flush()
    foreign = Project(org_id=other.id, name="Secret", slug="secret")
    db.add(foreign)
    db.flush()

    assert authed.post(f"/api/projects/{foreign.id}/undo").status_code == 404


# --- пачка -------------------------------------------------------------------


@pytest.fixture
def batch(db, authed):
    """Пачка мутаций с общим batch_id — так их применяет AI."""
    project_id = authed.post("/api/projects", json={"name": "AI"}).json()["id"]
    project = db.get(Project, uuid.UUID(project_id))
    batch_id = uuid.uuid4()

    created = apply_op(
        db,
        project,
        CreateCategory(name="Дизайн", color="#3b82f6"),
        actor_id=None,
        batch_id=batch_id,
    )
    category_id = created.op["category_id"]
    for name in ("Логотип", "Макет"):
        apply_op(
            db,
            project,
            CreateTask(
                category_id=category_id,
                name=name,
                start_date="2026-03-02",
                duration_days=2,
            ),
            actor_id=None,
            batch_id=batch_id,
        )
    return project_id, str(batch_id)


def test_a_whole_batch_rolls_back_with_one_call(authed, db, batch):
    project_id, batch_id = batch

    response = authed.post(f"/api/projects/{project_id}/batches/{batch_id}/undo")

    assert response.status_code == 201
    assert response.json()["undone"] == 3
    state = _state(authed, project_id)
    assert state["tasks"] == []
    # Категория тоже ушла: откат идёт с конца, иначе он упёрся бы в непустую
    # категорию и оставил половину пачки в проекте.
    assert state["categories"] == []


def test_rolling_the_same_batch_back_twice_is_refused(authed, batch):
    project_id, batch_id = batch
    authed.post(f"/api/projects/{project_id}/batches/{batch_id}/undo")

    again = authed.post(f"/api/projects/{project_id}/batches/{batch_id}/undo")

    assert again.status_code == 404
    assert again.json()["detail"] == "batch_not_found"


def test_an_unknown_batch_is_not_found(authed, batch):
    project_id, _ = batch

    response = authed.post(f"/api/projects/{project_id}/batches/{uuid.uuid4()}/undo")

    assert response.status_code == 404


def test_the_undo_of_a_batch_is_recorded_as_one_action(db, authed, batch):
    """Откат пачки читается в журнале одним действием, а не россыпью записей."""
    project_id, batch_id = batch
    project = db.get(Project, uuid.UUID(project_id))

    applied = undo_batch(db, project, uuid.UUID(batch_id), actor_id=None)

    undo_batch_ids = {revision.batch_id for revision in applied}
    assert len(undo_batch_ids) == 1
    assert undo_batch_ids != {uuid.UUID(batch_id)}
    # И ни одна категория не осталась в проекте: откатилась вся пачка.
    assert db.scalar(select(Category).where(Category.project_id == project.id)) is None


def test_undoing_a_batch_member_by_hand_is_skipped_by_the_batch_undo(db, authed, batch):
    """Ревизия, отменённая поодиночке, во второй раз не отменяется.

    Иначе откат пачки применил бы её обратную операцию ещё раз — и создание
    задачи, уже отменённое, попыталось бы удалить несуществующую строку.
    """
    project_id, batch_id = batch
    project = db.get(Project, uuid.UUID(project_id))
    last = last_undoable(db, project)
    assert last is not None
    authed.post(f"/api/projects/{project_id}/undo")

    applied = undo_batch(db, project, uuid.UUID(batch_id), actor_id=None)

    assert last.seq not in {revision.undoes_seq for revision in applied}
    assert db.scalar(select(Revision).where(Revision.undoes_seq == last.seq)) is not None
