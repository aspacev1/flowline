import uuid
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.models import Category, Criticality, Project, Revision, Task


class MutationError(Exception):
    """Отказ применить операцию.

    Несёт стабильный машинный код для ответа и человеческий текст — для
    журнала. Текст в тело ответа не попадает: язык интерфейса по умолчанию
    азербайджанский, словарей сообщений сервер сознательно не держит (их
    составляет клиент), поэтому проза в `detail` непереводима.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class NotFoundInProject(MutationError):
    """Названная сущность не существует или принадлежит другому проекту.

    Отдельный класс от InvalidOperation: обращение к задаче чужой
    организации — это не ошибка формата запроса, и маршрут отвечает на него
    404, а не 422.
    """


class InvalidOperation(MutationError):
    """Операция составлена так, что применить её нельзя."""


# --- внутреннее представление ------------------------------------------------
#
# Эти модели описывают операцию так, как её видит домен и как она лежит в
# журнале ревизий. У создающих операций есть поля восстановления — category_id,
# task_id, position, — потому что отмена удаления обязана вернуть строку под
# её прежним идентификатором и на прежнее место. По проводу такие поля
# принимать нельзя: они отдают клиенту назначение идентификаторов и позволяют
# положить строку на произвольный индекс. Публичный контракт — ниже,
# отдельными моделями; to_internal() переводит одно в другое.


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

_MODELS = {
    "create_category": CreateCategory,
    "create_task": CreateTask,
    "move_task": MoveTask,
    "set_duration": SetDuration,
    "delete_task": DeleteTask,
    "delete_category": DeleteCategory,
}


# --- контракт по проводу -----------------------------------------------------
#
# Границы длин повторяют ширину колонок: без них строка длиннее varchar
# приезжает в базу и возвращается пятисоткой на ошибке усечения, а не честным
# отказом клиенту. extra="forbid" выбран сознательно вместо тихого
# игнорирования: клиент, приславший task_id или position в расчёте, что сервер
# их учтёт, должен узнать об этом сразу, а не гадать потом, почему строка
# оказалась не там.

_MAX_TEXT_LEN = get_settings().max_text_len


class _Wire(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)


class PublicCreateCategory(_Wire):
    type: Literal["create_category"] = "create_category"
    name: str = Field(min_length=1, max_length=200)
    color: str = Field(min_length=1, max_length=9)


class PublicCreateTask(_Wire):
    type: Literal["create_task"] = "create_task"
    category_id: uuid.UUID
    name: str = Field(min_length=1, max_length=300)
    start_date: date
    duration_days: int = Field(ge=1)
    description: str = Field(default="", max_length=_MAX_TEXT_LEN)
    internal_note: str = Field(default="", max_length=_MAX_TEXT_LEN)
    criticality: Criticality = Criticality.NORMAL
    progress_pct: int = Field(default=0, ge=0, le=100)
    baseline_start: date | None = None
    baseline_duration: int | None = Field(default=None, ge=1)


class PublicMoveTask(_Wire):
    type: Literal["move_task"] = "move_task"
    task_id: uuid.UUID
    start_date: date


class PublicSetDuration(_Wire):
    type: Literal["set_duration"] = "set_duration"
    task_id: uuid.UUID
    duration_days: int = Field(ge=1)


class PublicDeleteTask(_Wire):
    type: Literal["delete_task"] = "delete_task"
    task_id: uuid.UUID


class PublicDeleteCategory(_Wire):
    type: Literal["delete_category"] = "delete_category"
    category_id: uuid.UUID


PublicOp = Annotated[
    PublicCreateCategory
    | PublicCreateTask
    | PublicMoveTask
    | PublicSetDuration
    | PublicDeleteTask
    | PublicDeleteCategory,
    Field(discriminator="type"),
]


def to_internal(op) -> Op:
    """Операция с провода → внутреннее представление.

    Поля восстановления не переносятся просто потому, что их нет в публичной
    модели: назначение идентификаторов и позиций остаётся за сервером.
    """
    return _MODELS[op.type].model_validate(op.model_dump())


def _next_seq(db: DbSession, project: Project) -> int:
    current = db.scalar(
        select(func.coalesce(func.max(Revision.seq), 0)).where(Revision.project_id == project.id)
    )
    return current + 1


def _require_task(db: DbSession, project: Project, task_id: uuid.UUID) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.project_id != project.id:
        raise NotFoundInProject("task_not_found", "задача не найдена в этом проекте")
    return task


def _require_category(db: DbSession, project: Project, category_id: uuid.UUID) -> Category:
    category = db.get(Category, category_id)
    if category is None or category.project_id != project.id:
        raise NotFoundInProject("category_not_found", "категория не найдена в этом проекте")
    return category


def _apply(db: DbSession, project: Project, op) -> tuple[dict, dict]:
    """Применяет операцию и возвращает пару (что записать в op, что записать в inverse)."""

    if isinstance(op, CreateCategory):
        # max(position) + 1, а не COUNT(*): удаление пробивает дыру в
        # нумерации, и COUNT(*) после удаления вновь выдаёт уже занятый
        # номер. coalesce(..., -1) даёт 0 для пустой коллекции без отдельной
        # ветки.
        position = (
            op.position
            if op.position is not None
            else db.scalar(
                select(func.coalesce(func.max(Category.position), -1) + 1).where(
                    Category.project_id == project.id
                )
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
            raise InvalidOperation("duration_too_short", "длительность должна быть не меньше одного дня")
        # Внешний ключ гарантирует лишь, что категория где-то существует —
        # не то, что она принадлежит этому проекту. Без явной проверки задача
        # может незаметно оказаться под категорией чужого проекта.
        _require_category(db, project, op.category_id)
        # Потолок из настроек (MAX_TASKS_PER_PROJECT): проверяется здесь, а не
        # в маршруте, потому что это правило домена, а не формы запроса.
        limit = get_settings().max_tasks_per_project
        existing = db.scalar(
            select(func.count()).select_from(Task).where(Task.project_id == project.id)
        )
        if existing >= limit:
            raise InvalidOperation(
                "task_limit_reached", f"в проекте уже {existing} задач при потолке {limit}"
            )
        # Тот же принцип, что и для категорий: наибольшая занятая позиция + 1,
        # а не COUNT(*) — иначе номер, освободившийся после удаления,
        # достаётся следующей же созданной задаче ещё раз.
        position = (
            op.position
            if op.position is not None
            else db.scalar(
                select(func.coalesce(func.max(Task.position), -1) + 1).where(
                    Task.project_id == project.id
                )
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
            raise InvalidOperation("duration_too_short", "длительность должна быть не меньше одного дня")
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
            raise InvalidOperation("category_not_empty", "категория не пуста")
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

    raise InvalidOperation("unknown_operation", f"неизвестная операция: {op!r}")


def apply_op(
    db: DbSession,
    project: Project,
    op,
    *,
    actor_id: uuid.UUID | None,
    reason: str | None = None,
    batch_id: uuid.UUID | None = None,
) -> Revision:
    # Блокировка строки проекта на всё время применения операции. Без неё два
    # запроса, правящих один проект, считают max(seq)+1 из одного и того же
    # снимка: проигравший нарушает уникальное ограничение (project_id, seq), и
    # вызывающий получает голую пятисотку. Та же гонка дублирует position, где
    # ограничения нет вовсе и расхождение остаётся незамеченным. Совместное
    # редактирование одного проекта — нормальный режим этого продукта, а не
    # редкий случай; когда конкуренции нет, блокировка не стоит ничего.
    db.execute(select(Project.id).where(Project.id == project.id).with_for_update())
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
