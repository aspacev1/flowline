from datetime import date

import pytest

from app.models import Category, Organization, Project, Revision, Task
from app.mutations import (
    CreateCategory,
    CreateTask,
    DeleteCategory,
    DeleteTask,
    InvalidOperation,
    MoveTask,
    NotFoundInProject,
    SetDuration,
    apply_op,
    undo,
)


@pytest.fixture
def project(db):
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    project = Project(org_id=org.id, name="Redesign", slug="redesign")
    db.add(project)
    db.flush()
    return project


@pytest.fixture
def category(db, project):
    revision = apply_op(
        db,
        project,
        CreateCategory(name="Design", color="#3b82f6"),
        actor_id=None,
    )
    return db.get(Category, revision.op["category_id"])


@pytest.fixture
def other_project(db):
    org = Organization(name="Globex", slug="globex")
    db.add(org)
    db.flush()
    project = Project(org_id=org.id, name="Migration", slug="migration")
    db.add(project)
    db.flush()
    return project


@pytest.fixture
def other_category(db, other_project):
    revision = apply_op(
        db,
        other_project,
        CreateCategory(name="Ops", color="#22c55e"),
        actor_id=None,
    )
    return db.get(Category, revision.op["category_id"])


def test_create_task_writes_a_revision_after_the_category_one(db, project, category):
    revision = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id),
            name="Logo",
            start_date=date(2026, 3, 4),
            duration_days=5,
        ),
        actor_id=None,
    )

    assert revision.seq == 2  # первая ревизия ушла на создание категории
    assert revision.op["type"] == "create_task"
    assert revision.inverse["type"] == "delete_task"

    task = db.get(Task, revision.op["task_id"])
    assert task.name == "Logo"
    assert task.duration_days == 5


def test_seq_increments_per_project(db, project, category):
    for index in range(3):
        apply_op(
            db,
            project,
            CreateTask(
                category_id=str(category.id),
                name=f"Task {index}",
                start_date=date(2026, 3, 4),
                duration_days=2,
            ),
            actor_id=None,
        )

    numbers = [r.seq for r in db.query(Revision).order_by(Revision.seq).all()]
    assert numbers == [1, 2, 3, 4]


def test_move_task_records_both_dates(db, project, category):
    created = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id),
            name="Logo",
            start_date=date(2026, 3, 4),
            duration_days=5,
        ),
        actor_id=None,
    )
    task_id = created.op["task_id"]

    moved = apply_op(
        db,
        project,
        MoveTask(task_id=task_id, start_date=date(2026, 3, 11)),
        actor_id=None,
        reason="брендбук задержали",
    )

    assert moved.op == {
        "type": "move_task",
        "task_id": task_id,
        "from": "2026-03-04",
        "to": "2026-03-11",
    }
    assert moved.inverse["to"] == "2026-03-04"
    assert moved.reason == "брендбук задержали"


def test_undo_restores_the_previous_state(db, project, category):
    created = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id),
            name="Logo",
            start_date=date(2026, 3, 4),
            duration_days=5,
        ),
        actor_id=None,
    )
    task_id = created.op["task_id"]

    moved = apply_op(
        db, project, MoveTask(task_id=task_id, start_date=date(2026, 3, 11)), actor_id=None
    )
    undo(db, project, moved, actor_id=None)

    assert db.get(Task, task_id).start_date == date(2026, 3, 4)


def test_undo_of_a_delete_brings_the_task_back_with_the_same_id(db, project, category):
    created = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id),
            name="Logo",
            start_date=date(2026, 3, 4),
            duration_days=5,
        ),
        actor_id=None,
    )
    task_id = created.op["task_id"]

    deleted = apply_op(db, project, DeleteTask(task_id=task_id), actor_id=None)
    assert db.get(Task, task_id) is None

    undo(db, project, deleted, actor_id=None)
    restored = db.get(Task, task_id)
    assert restored is not None
    assert restored.name == "Logo"


def test_deleting_a_non_empty_category_is_refused(db, project, category):
    apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id),
            name="Logo",
            start_date=date(2026, 3, 4),
            duration_days=5,
        ),
        actor_id=None,
    )

    with pytest.raises(InvalidOperation) as error:
        apply_op(db, project, DeleteCategory(category_id=str(category.id)), actor_id=None)
    assert error.value.code == "category_not_empty"


def test_undo_of_a_category_delete_restores_it_with_the_same_id(db, project, category):
    deleted = apply_op(db, project, DeleteCategory(category_id=str(category.id)), actor_id=None)
    assert db.get(Category, category.id) is None

    undo(db, project, deleted, actor_id=None)
    restored = db.get(Category, category.id)
    assert restored is not None
    assert restored.name == "Design"


def test_set_duration_rejects_zero(db, project, category):
    created = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id),
            name="Logo",
            start_date=date(2026, 3, 4),
            duration_days=5,
        ),
        actor_id=None,
    )

    with pytest.raises(InvalidOperation) as error:
        apply_op(
            db, project, SetDuration(task_id=created.op["task_id"], duration_days=0), actor_id=None
        )
    assert error.value.code == "duration_too_short"


def test_set_duration_changes_the_duration_and_records_both_bounds(db, project, category):
    created = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id),
            name="Logo",
            start_date=date(2026, 3, 4),
            duration_days=5,
        ),
        actor_id=None,
    )
    task_id = created.op["task_id"]

    changed = apply_op(
        db,
        project,
        SetDuration(task_id=task_id, duration_days=8),
        actor_id=None,
    )

    assert changed.op == {
        "type": "set_duration",
        "task_id": task_id,
        "from": 5,
        "to": 8,
    }
    assert changed.inverse == {
        "type": "set_duration",
        "task_id": task_id,
        "from": 8,
        "to": 5,
    }
    assert db.get(Task, task_id).duration_days == 8


def test_undo_of_set_duration_restores_the_previous_duration(db, project, category):
    created = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id),
            name="Logo",
            start_date=date(2026, 3, 4),
            duration_days=5,
        ),
        actor_id=None,
    )
    task_id = created.op["task_id"]

    changed = apply_op(db, project, SetDuration(task_id=task_id, duration_days=8), actor_id=None)
    undo(db, project, changed, actor_id=None)

    assert db.get(Task, task_id).duration_days == 5


def test_undo_of_create_task_removes_it(db, project, category):
    created = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id),
            name="Logo",
            start_date=date(2026, 3, 4),
            duration_days=5,
        ),
        actor_id=None,
    )
    task_id = created.op["task_id"]
    assert db.get(Task, task_id) is not None

    undo(db, project, created, actor_id=None)

    assert db.get(Task, task_id) is None


def test_undo_of_create_category_removes_it(db, project):
    created = apply_op(
        db,
        project,
        CreateCategory(name="Design", color="#3b82f6"),
        actor_id=None,
    )
    category_id = created.op["category_id"]
    assert db.get(Category, category_id) is not None

    undo(db, project, created, actor_id=None)

    assert db.get(Category, category_id) is None


def test_operation_naming_a_task_from_another_project_is_rejected(
    db, project, other_project, other_category
):
    foreign = apply_op(
        db,
        other_project,
        CreateTask(
            category_id=str(other_category.id),
            name="Foreign task",
            start_date=date(2026, 3, 4),
            duration_days=3,
        ),
        actor_id=None,
    )
    foreign_task_id = foreign.op["task_id"]

    with pytest.raises(NotFoundInProject) as error:
        apply_op(
            db,
            project,
            MoveTask(task_id=foreign_task_id, start_date=date(2026, 3, 11)),
            actor_id=None,
        )
    assert error.value.code == "task_not_found"


def test_create_task_rejects_a_category_from_another_project(db, project, other_category):
    with pytest.raises(NotFoundInProject) as error:
        apply_op(
            db,
            project,
            CreateTask(
                category_id=str(other_category.id),
                name="Logo",
                start_date=date(2026, 3, 4),
                duration_days=5,
            ),
            actor_id=None,
        )
    assert error.value.code == "category_not_found"


def test_create_after_a_delete_does_not_reuse_an_occupied_task_position(db, project, category):
    first = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id), name="First", start_date=date(2026, 3, 4), duration_days=2
        ),
        actor_id=None,
    )
    second = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id), name="Second", start_date=date(2026, 3, 4), duration_days=2
        ),
        actor_id=None,
    )
    apply_op(db, project, DeleteTask(task_id=first.op["task_id"]), actor_id=None)
    third = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id), name="Third", start_date=date(2026, 3, 4), duration_days=2
        ),
        actor_id=None,
    )

    # COUNT(*) после удаления считает оставшиеся строки, а не наибольший
    # занятый номер: после удаления первой из двух задач остаётся одна
    # строка, и COUNT(*) даёт 1 — тот же номер, что уже занят второй задачей.
    second_position = db.get(Task, second.op["task_id"]).position
    third_position = db.get(Task, third.op["task_id"]).position
    assert second_position != third_position


def test_create_after_a_delete_does_not_reuse_an_occupied_category_position(db, project):
    first = apply_op(db, project, CreateCategory(name="First", color="#111111"), actor_id=None)
    second = apply_op(db, project, CreateCategory(name="Second", color="#222222"), actor_id=None)
    apply_op(db, project, DeleteCategory(category_id=first.op["category_id"]), actor_id=None)
    third = apply_op(db, project, CreateCategory(name="Third", color="#333333"), actor_id=None)

    second_position = db.get(Category, second.op["category_id"]).position
    third_position = db.get(Category, third.op["category_id"]).position
    assert second_position != third_position


def test_undo_of_a_task_delete_restores_its_original_position(db, project, category):
    apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id), name="First", start_date=date(2026, 3, 4), duration_days=2
        ),
        actor_id=None,
    )
    second = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id), name="Second", start_date=date(2026, 3, 4), duration_days=2
        ),
        actor_id=None,
    )
    second_task_id = second.op["task_id"]
    assert db.get(Task, second_task_id).position == 1

    deleted = apply_op(db, project, DeleteTask(task_id=second_task_id), actor_id=None)
    # Другая задача занимает освободившееся место — наивный пересчёт при
    # отмене удаления сдвинул бы восстановленную задачу в конец списка.
    apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id), name="Third", start_date=date(2026, 3, 4), duration_days=2
        ),
        actor_id=None,
    )

    undo(db, project, deleted, actor_id=None)

    assert db.get(Task, second_task_id).position == 1
