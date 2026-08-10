from datetime import date

import pytest

from app.models import Category, Organization, Project, Revision, Task
from app.mutations import (
    CreateCategory,
    CreateTask,
    DeleteCategory,
    DeleteTask,
    MoveTask,
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

    with pytest.raises(ValueError, match="не пуста"):
        apply_op(db, project, DeleteCategory(category_id=str(category.id)), actor_id=None)


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

    with pytest.raises(ValueError):
        apply_op(
            db, project, SetDuration(task_id=created.op["task_id"], duration_days=0), actor_id=None
        )
