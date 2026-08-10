import uuid
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.models import Category, Project, Revision, Task


class CreateCategory(BaseModel):
    type: Literal["create_category"] = "create_category"
    name: str
    color: str
    category_id: uuid.UUID | None = None
    position: int | None = None


class CreateTask(BaseModel):
    type: Literal["create_task"] = "create_task"
    category_id: uuid.UUID
    name: str
    start_date: date
    duration_days: int
    description: str = ""
    internal_note: str = ""
    criticality: str = "normal"
    progress_pct: int = 0
    baseline_start: date | None = None
    baseline_duration: int | None = None
    task_id: uuid.UUID | None = None
    position: int | None = None


class MoveTask(BaseModel):
    type: Literal["move_task"] = "move_task"
    task_id: uuid.UUID
    start_date: date


class SetDuration(BaseModel):
    type: Literal["set_duration"] = "set_duration"
    task_id: uuid.UUID
    duration_days: int


class DeleteTask(BaseModel):
    type: Literal["delete_task"] = "delete_task"
    task_id: uuid.UUID


class DeleteCategory(BaseModel):
    type: Literal["delete_category"] = "delete_category"
    category_id: uuid.UUID


Op = Annotated[
    CreateCategory | CreateTask | MoveTask | SetDuration | DeleteTask | DeleteCategory,
    Field(discriminator="type"),
]


def _next_seq(db: DbSession, project: Project) -> int:
    current = db.scalar(
        select(func.coalesce(func.max(Revision.seq), 0)).where(Revision.project_id == project.id)
    )
    return current + 1


def _require_task(db: DbSession, project: Project, task_id: uuid.UUID) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.project_id != project.id:
        raise ValueError("задача не найдена в этом проекте")
    return task


def _require_category(db: DbSession, project: Project, category_id: uuid.UUID) -> Category:
    category = db.get(Category, category_id)
    if category is None or category.project_id != project.id:
        raise ValueError("категория не найдена в этом проекте")
    return category


def _apply(db: DbSession, project: Project, op) -> tuple[dict, dict]:
    """Применяет операцию и возвращает пару (что записать в op, что записать в inverse)."""

    if isinstance(op, CreateCategory):
        position = (
            op.position
            if op.position is not None
            else db.scalar(
                select(func.count()).select_from(Category).where(Category.project_id == project.id)
            )
        )
        category = Category(
            id=op.category_id or uuid.uuid4(),
            project_id=project.id,
            name=op.name,
            color=op.color,
            position=position,
        )
        db.add(category)
        db.flush()
        return (
            {"type": "create_category", "category_id": str(category.id), "name": op.name,
             "color": op.color, "position": category.position},
            {"type": "delete_category", "category_id": str(category.id)},
        )

    if isinstance(op, CreateTask):
        if op.duration_days < 1:
            raise ValueError("длительность должна быть не меньше одного дня")
        # Внешний ключ гарантирует лишь, что категория где-то существует —
        # не то, что она принадлежит этому проекту. Без явной проверки задача
        # может незаметно оказаться под категорией чужого проекта.
        _require_category(db, project, op.category_id)
        position = (
            op.position
            if op.position is not None
            else db.scalar(
                select(func.count()).select_from(Task).where(Task.project_id == project.id)
            )
        )
        task = Task(
            id=op.task_id or uuid.uuid4(),
            project_id=project.id,
            category_id=op.category_id,
            name=op.name,
            description=op.description,
            internal_note=op.internal_note,
            start_date=op.start_date,
            duration_days=op.duration_days,
            criticality=op.criticality,
            progress_pct=op.progress_pct,
            position=position,
            baseline_start=op.baseline_start,
            baseline_duration=op.baseline_duration,
        )
        db.add(task)
        db.flush()
        return (
            {
                "type": "create_task",
                "task_id": str(task.id),
                "category_id": str(task.category_id),
                "name": task.name,
                "start_date": task.start_date.isoformat(),
                "duration_days": task.duration_days,
                "description": task.description,
                "internal_note": task.internal_note,
                "criticality": task.criticality,
                "progress_pct": task.progress_pct,
                "position": task.position,
                "baseline_start": task.baseline_start.isoformat() if task.baseline_start else None,
                "baseline_duration": task.baseline_duration,
            },
            {"type": "delete_task", "task_id": str(task.id)},
        )

    if isinstance(op, MoveTask):
        task = _require_task(db, project, op.task_id)
        previous = task.start_date
        task.start_date = op.start_date
        db.flush()
        return (
            {"type": "move_task", "task_id": str(task.id), "from": previous.isoformat(),
             "to": op.start_date.isoformat()},
            {"type": "move_task", "task_id": str(task.id), "from": op.start_date.isoformat(),
             "to": previous.isoformat()},
        )

    if isinstance(op, SetDuration):
        if op.duration_days < 1:
            raise ValueError("длительность должна быть не меньше одного дня")
        task = _require_task(db, project, op.task_id)
        previous = task.duration_days
        task.duration_days = op.duration_days
        db.flush()
        return (
            {"type": "set_duration", "task_id": str(task.id), "from": previous,
             "to": op.duration_days},
            {"type": "set_duration", "task_id": str(task.id), "from": op.duration_days,
             "to": previous},
        )

    if isinstance(op, DeleteCategory):
        category = _require_category(db, project, op.category_id)
        remaining = db.scalar(
            select(func.count()).select_from(Task).where(Task.category_id == category.id)
        )
        # Удаление непустой категории унесло бы задачи каскадом, и обратная
        # операция их бы не вернула. Требуем сначала разобрать содержимое.
        if remaining:
            raise ValueError("категория не пуста")
        snapshot = {
            "type": "create_category",
            "category_id": str(category.id),
            "name": category.name,
            "color": category.color,
            "position": category.position,
        }
        db.delete(category)
        db.flush()
        return ({"type": "delete_category", "category_id": str(op.category_id)}, snapshot)

    if isinstance(op, DeleteTask):
        task = _require_task(db, project, op.task_id)
        snapshot = {
            "type": "create_task",
            "task_id": str(task.id),
            "category_id": str(task.category_id),
            "name": task.name,
            "start_date": task.start_date.isoformat(),
            "duration_days": task.duration_days,
            "description": task.description,
            "internal_note": task.internal_note,
            "criticality": task.criticality,
            "progress_pct": task.progress_pct,
            "position": task.position,
            "baseline_start": task.baseline_start.isoformat() if task.baseline_start else None,
            "baseline_duration": task.baseline_duration,
        }
        db.delete(task)
        db.flush()
        return ({"type": "delete_task", "task_id": str(op.task_id)}, snapshot)

    raise ValueError(f"неизвестная операция: {op!r}")


def apply_op(
    db: DbSession,
    project: Project,
    op,
    *,
    actor_id: uuid.UUID | None,
    reason: str | None = None,
    batch_id: uuid.UUID | None = None,
) -> Revision:
    forward, inverse = _apply(db, project, op)
    revision = Revision(
        project_id=project.id,
        seq=_next_seq(db, project),
        actor_user_id=actor_id,
        op=forward,
        inverse=inverse,
        reason=reason,
        batch_id=batch_id,
    )
    db.add(revision)
    db.flush()
    return revision


_MODELS = {
    "create_category": CreateCategory,
    "create_task": CreateTask,
    "move_task": MoveTask,
    "set_duration": SetDuration,
    "delete_task": DeleteTask,
    "delete_category": DeleteCategory,
}


def _op_from_dict(payload: dict):
    """Восстанавливает операцию из записи журнала.

    В журнале move_task и set_duration хранят обе границы (from и to), поэтому
    поле значения берётся из to — так одна и та же запись читается и как
    прямая операция, и как обратная.
    """
    kind = payload["type"]
    model = _MODELS[kind]
    data = dict(payload)
    if kind == "move_task":
        data["start_date"] = data.pop("to")
        data.pop("from", None)
    elif kind == "set_duration":
        data["duration_days"] = data.pop("to")
        data.pop("from", None)
    return model.model_validate(data)


def undo(db: DbSession, project: Project, revision: Revision, *, actor_id: uuid.UUID | None) -> Revision:
    return apply_op(db, project, _op_from_dict(revision.inverse), actor_id=actor_id)
