import uuid
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.models import (
    CRITICALITY_LEVELS,
    Category,
    Criticality,
    Dependency,
    Membership,
    Project,
    Revision,
    Task,
    TaskAssignee,
)


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


class SetTaskFields(BaseModel):
    """Три текстовых поля разом.

    Карточка задачи сохраняет их одним действием; разбить это на три ревизии
    значило бы засорять историю тремя записями там, где человек сделал одно
    изменение.
    """

    type: Literal["set_task_fields"] = "set_task_fields"
    task_id: uuid.UUID
    name: str
    description: str
    internal_note: str


class SetCriticality(BaseModel):
    type: Literal["set_criticality"] = "set_criticality"
    task_id: uuid.UUID
    criticality: str


class SetProgress(BaseModel):
    type: Literal["set_progress"] = "set_progress"
    task_id: uuid.UUID
    progress_pct: int


class RenameCategory(BaseModel):
    type: Literal["rename_category"] = "rename_category"
    category_id: uuid.UUID
    name: str


class SetCategoryColor(BaseModel):
    type: Literal["set_category_color"] = "set_category_color"
    category_id: uuid.UUID
    color: str


class ReorderTask(BaseModel):
    type: Literal["reorder_task"] = "reorder_task"
    task_id: uuid.UUID
    category_id: uuid.UUID
    position: int


class AddDependency(BaseModel):
    type: Literal["add_dependency"] = "add_dependency"
    from_task_id: uuid.UUID
    to_task_id: uuid.UUID


class RemoveDependency(BaseModel):
    type: Literal["remove_dependency"] = "remove_dependency"
    from_task_id: uuid.UUID
    to_task_id: uuid.UUID


class AssignUser(BaseModel):
    type: Literal["assign_user"] = "assign_user"
    task_id: uuid.UUID
    user_id: uuid.UUID


class UnassignUser(BaseModel):
    type: Literal["unassign_user"] = "unassign_user"
    task_id: uuid.UUID
    user_id: uuid.UUID


class ApplyPositions(BaseModel):
    """Внутренняя операция: расставить позиции по готовой карте.

    Существует только как обратная к reorder_task. По проводу не принимается —
    в публичном реестре её нет: иначе клиент прислал бы произвольную карту и
    расставил строки в обход всякой проверки порядка.
    """

    type: Literal["apply_positions"] = "apply_positions"
    positions: dict[uuid.UUID, int]
    categories: dict[uuid.UUID, uuid.UUID]


Op = Annotated[
    CreateCategory
    | CreateTask
    | MoveTask
    | SetDuration
    | DeleteTask
    | DeleteCategory
    | SetTaskFields
    | SetCriticality
    | SetProgress
    | RenameCategory
    | SetCategoryColor
    | ReorderTask
    | ApplyPositions
    | AddDependency
    | RemoveDependency
    | AssignUser
    | UnassignUser,
    Field(discriminator="type"),
]

_MODELS = {
    "create_category": CreateCategory,
    "create_task": CreateTask,
    "move_task": MoveTask,
    "set_duration": SetDuration,
    "delete_task": DeleteTask,
    "delete_category": DeleteCategory,
    "set_task_fields": SetTaskFields,
    "set_criticality": SetCriticality,
    "set_progress": SetProgress,
    "rename_category": RenameCategory,
    "set_category_color": SetCategoryColor,
    "reorder_task": ReorderTask,
    "apply_positions": ApplyPositions,
    "add_dependency": AddDependency,
    "remove_dependency": RemoveDependency,
    "assign_user": AssignUser,
    "unassign_user": UnassignUser,
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


class PublicSetTaskFields(_Wire):
    type: Literal["set_task_fields"] = "set_task_fields"
    task_id: uuid.UUID
    name: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=_MAX_TEXT_LEN)
    internal_note: str = Field(default="", max_length=_MAX_TEXT_LEN)


class PublicSetCriticality(_Wire):
    type: Literal["set_criticality"] = "set_criticality"
    task_id: uuid.UUID
    criticality: Criticality


class PublicSetProgress(_Wire):
    type: Literal["set_progress"] = "set_progress"
    task_id: uuid.UUID
    progress_pct: int = Field(ge=0, le=100)


class PublicRenameCategory(_Wire):
    type: Literal["rename_category"] = "rename_category"
    category_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)


class PublicSetCategoryColor(_Wire):
    type: Literal["set_category_color"] = "set_category_color"
    category_id: uuid.UUID
    color: str = Field(min_length=1, max_length=9)


class PublicReorderTask(_Wire):
    type: Literal["reorder_task"] = "reorder_task"
    task_id: uuid.UUID
    category_id: uuid.UUID
    position: int = Field(ge=0)


class PublicAddDependency(_Wire):
    type: Literal["add_dependency"] = "add_dependency"
    from_task_id: uuid.UUID
    to_task_id: uuid.UUID


class PublicRemoveDependency(_Wire):
    type: Literal["remove_dependency"] = "remove_dependency"
    from_task_id: uuid.UUID
    to_task_id: uuid.UUID


class PublicAssignUser(_Wire):
    type: Literal["assign_user"] = "assign_user"
    task_id: uuid.UUID
    user_id: uuid.UUID


class PublicUnassignUser(_Wire):
    type: Literal["unassign_user"] = "unassign_user"
    task_id: uuid.UUID
    user_id: uuid.UUID


# ApplyPositions публичного зеркала не имеет и иметь не должна: она внутренняя.


PublicOp = Annotated[
    PublicCreateCategory
    | PublicCreateTask
    | PublicMoveTask
    | PublicSetDuration
    | PublicDeleteTask
    | PublicDeleteCategory
    | PublicSetTaskFields
    | PublicSetCriticality
    | PublicSetProgress
    | PublicRenameCategory
    | PublicSetCategoryColor
    | PublicReorderTask
    | PublicAddDependency
    | PublicRemoveDependency
    | PublicAssignUser
    | PublicUnassignUser,
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


def _find_dependency(
    db: DbSession, project: Project, from_task_id: uuid.UUID, to_task_id: uuid.UUID
) -> Dependency | None:
    """Связь по обоим концам, ограниченная этим проектом.

    project_id в условии избыточен, пока обе задачи уже проверены
    _require_task, — но он же делает запрос верным сам по себе, без опоры на
    то, что вызывающий не забыл проверку.
    """
    return db.scalar(
        select(Dependency).where(
            Dependency.project_id == project.id,
            Dependency.from_task_id == from_task_id,
            Dependency.to_task_id == to_task_id,
        )
    )


def _find_assignment(
    db: DbSession, task_id: uuid.UUID, user_id: uuid.UUID
) -> TaskAssignee | None:
    return db.scalar(
        select(TaskAssignee).where(
            TaskAssignee.task_id == task_id, TaskAssignee.user_id == user_id
        )
    )


# Поля, которые карточка задачи сохраняет одним действием.
_TASK_FIELDS = ("name", "description", "internal_note")


def _swap(payload: dict) -> dict:
    """Обратная операция отличается от прямой только местами from и to.

    Один помощник вместо ветки инверсии в каждой операции: пара границ —
    это уже полное описание и прямого действия, и обратного.
    """
    return {**payload, "from": payload["to"], "to": payload["from"]}


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

    if isinstance(op, SetTaskFields):
        task = _require_task(db, project, op.task_id)
        before = {field: getattr(task, field) for field in _TASK_FIELDS}
        after = {
            "name": op.name,
            "description": op.description,
            "internal_note": op.internal_note,
        }
        for field, value in after.items():
            setattr(task, field, value)
        db.flush()
        forward = {
            "type": "set_task_fields",
            "task_id": str(task.id),
            "from": before,
            "to": after,
        }
        return forward, _swap(forward)

    if isinstance(op, SetCriticality):
        if op.criticality not in CRITICALITY_LEVELS:
            raise InvalidOperation(
                "unknown_criticality", f"неизвестный уровень: {op.criticality}"
            )
        task = _require_task(db, project, op.task_id)
        forward = {
            "type": "set_criticality",
            "task_id": str(task.id),
            "from": task.criticality,
            "to": op.criticality,
        }
        task.criticality = op.criticality
        db.flush()
        return forward, _swap(forward)

    if isinstance(op, SetProgress):
        if not 0 <= op.progress_pct <= 100:
            raise InvalidOperation(
                "progress_out_of_range", f"процент вне 0..100: {op.progress_pct}"
            )
        task = _require_task(db, project, op.task_id)
        forward = {
            "type": "set_progress",
            "task_id": str(task.id),
            "from": task.progress_pct,
            "to": op.progress_pct,
        }
        task.progress_pct = op.progress_pct
        db.flush()
        return forward, _swap(forward)

    if isinstance(op, RenameCategory):
        category = _require_category(db, project, op.category_id)
        forward = {
            "type": "rename_category",
            "category_id": str(category.id),
            "from": category.name,
            "to": op.name,
        }
        category.name = op.name
        db.flush()
        return forward, _swap(forward)

    if isinstance(op, SetCategoryColor):
        category = _require_category(db, project, op.category_id)
        forward = {
            "type": "set_category_color",
            "category_id": str(category.id),
            "from": category.color,
            "to": op.color,
        }
        category.color = op.color
        db.flush()
        return forward, _swap(forward)

    if isinstance(op, AssignUser):
        task = _require_task(db, project, op.task_id)
        # Без этой проверки задачу можно повесить на постороннего, и сам факт
        # его существования утёк бы наружу: попадание в ответ проекта — это
        # уже наблюдаемое различие между «такого адреса нет» и «есть».
        member = db.scalar(
            select(Membership.id).where(
                Membership.org_id == project.org_id, Membership.user_id == op.user_id
            )
        )
        if member is None:
            raise InvalidOperation("user_not_in_organization", "пользователь не в этой организации")
        if _find_assignment(db, task.id, op.user_id) is not None:
            raise InvalidOperation("already_assigned", "этот человек уже назначен")
        db.add(TaskAssignee(task_id=task.id, user_id=op.user_id))
        db.flush()
        pair = {"task_id": str(task.id), "user_id": str(op.user_id)}
        return {"type": "assign_user", **pair}, {"type": "unassign_user", **pair}

    if isinstance(op, UnassignUser):
        # Проверки членства здесь нет намеренно: снять назначение с того, кто
        # уже покинул организацию, — законное действие, а не отказ.
        task = _require_task(db, project, op.task_id)
        assignment = _find_assignment(db, task.id, op.user_id)
        if assignment is None:
            raise NotFoundInProject("assignment_not_found", "назначение не найдено")
        db.delete(assignment)
        db.flush()
        pair = {"task_id": str(task.id), "user_id": str(op.user_id)}
        return {"type": "unassign_user", **pair}, {"type": "assign_user", **pair}

    if isinstance(op, AddDependency):
        # Связи по спеку — стрелки на картинке, а не правило расчёта: даты по
        # ним не пересчитываются. Но мусор в них допускать нельзя.
        if op.from_task_id == op.to_task_id:
            raise InvalidOperation("self_dependency", "задача не может зависеть от себя")
        # Обе стороны через _require_task: связь с задачей чужого проекта
        # отсекается тем же механизмом, что и всё остальное.
        _require_task(db, project, op.from_task_id)
        _require_task(db, project, op.to_task_id)
        if _find_dependency(db, project, op.from_task_id, op.to_task_id) is not None:
            raise InvalidOperation("dependency_exists", "такая связь уже есть")
        db.add(
            Dependency(
                project_id=project.id,
                from_task_id=op.from_task_id,
                to_task_id=op.to_task_id,
            )
        )
        db.flush()
        ends = {"from_task_id": str(op.from_task_id), "to_task_id": str(op.to_task_id)}
        return {"type": "add_dependency", **ends}, {"type": "remove_dependency", **ends}

    if isinstance(op, RemoveDependency):
        _require_task(db, project, op.from_task_id)
        _require_task(db, project, op.to_task_id)
        dependency = _find_dependency(db, project, op.from_task_id, op.to_task_id)
        if dependency is None:
            raise NotFoundInProject("dependency_not_found", "связь не найдена в этом проекте")
        db.delete(dependency)
        db.flush()
        ends = {"from_task_id": str(op.from_task_id), "to_task_id": str(op.to_task_id)}
        return {"type": "remove_dependency", **ends}, {"type": "add_dependency", **ends}

    if isinstance(op, ReorderTask):
        if op.position < 0:
            raise InvalidOperation("negative_position", "позиция не может быть отрицательной")
        task = _require_task(db, project, op.task_id)
        _require_category(db, project, op.category_id)

        # Снимок по всему проекту, а не по одной категории: перенос между
        # категориями меняет обе, и половинчатая карта отменялась бы
        # наполовину.
        rows = db.scalars(
            select(Task).where(Task.project_id == project.id).order_by(Task.position, Task.id)
        ).all()
        before_pos = {str(row.id): row.position for row in rows}
        before_cat = {str(row.id): str(row.category_id) for row in rows}

        siblings = [
            row for row in rows if row.category_id == op.category_id and row.id != task.id
        ]
        # Позиция за концом списка — не отказ: перетаскивание в самый низ
        # присылает индекс, равный длине, и это нормальный жест.
        index = min(op.position, len(siblings))
        ordered = siblings[:index] + [task] + siblings[index:]

        task.category_id = op.category_id
        for slot, row in enumerate(ordered):
            row.position = slot
        db.flush()

        after_pos = {str(row.id): row.position for row in rows}
        after_cat = {str(row.id): str(row.category_id) for row in rows}
        forward = {
            "type": "reorder_task",
            "task_id": str(task.id),
            "from": before_pos,
            "to": after_pos,
            "categories_from": before_cat,
            "categories_to": after_cat,
        }
        inverse = {
            "type": "apply_positions",
            "positions": before_pos,
            "categories": before_cat,
        }
        return forward, inverse

    if isinstance(op, ApplyPositions):
        before_pos: dict[str, int] = {}
        before_cat: dict[str, str] = {}
        for raw_id, position in op.positions.items():
            row = _require_task(db, project, raw_id)
            before_pos[str(row.id)] = row.position
            before_cat[str(row.id)] = str(row.category_id)
            row.position = position
            row.category_id = op.categories[raw_id]
        db.flush()
        # Ключи приводятся к строкам: в модели они uuid.UUID, а json.dumps
        # на пути в jsonb на таком ключе падает — запись журнала не легла бы
        # вовсе.
        forward = {
            "type": "apply_positions",
            "positions": {str(key): value for key, value in op.positions.items()},
            "categories": {str(key): str(value) for key, value in op.categories.items()},
        }
        inverse = {
            "type": "apply_positions",
            "positions": before_pos,
            "categories": before_cat,
        }
        return forward, inverse

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


# Операции, хранящие в журнале обе границы: имя поля модели, в которое ложится
# скалярное `to`. Отображение, а не цепочка elif: цепочка растёт вместе с
# числом операций и перестаёт читаться, а здесь новая операция — одна строка.
_SCALAR_BOUNDS_FIELD = {
    "move_task": "start_date",
    "set_duration": "duration_days",
    "set_criticality": "criticality",
    "set_progress": "progress_pct",
    "rename_category": "name",
    "set_category_color": "color",
}

# Операции, у которых `to` — не скаляр, а словарь полей: они разворачиваются
# в модель целиком.
_MAPPED_BOUNDS = frozenset({"set_task_fields"})


def _op_from_dict(payload: dict):
    """Восстанавливает операцию из записи журнала.

    Операции с парой границ хранят и from, и to, поэтому значение берётся из
    to — так одна и та же запись читается и как прямая операция, и как
    обратная (её inverse отличается лишь порядком этих двух полей).
    """
    kind = payload["type"]
    model = _MODELS[kind]
    data = dict(payload)
    if kind in _SCALAR_BOUNDS_FIELD:
        data[_SCALAR_BOUNDS_FIELD[kind]] = data.pop("to")
        data.pop("from", None)
    elif kind in _MAPPED_BOUNDS:
        data.update(data.pop("to"))
        data.pop("from", None)
    return model.model_validate(data)


def undo(db: DbSession, project: Project, revision: Revision, *, actor_id: uuid.UUID | None) -> Revision:
    # Каждый соседний помощник перепроверяет project_id, а undo принимал
    # ревизию на веру. Сегодня недостижимо — маршрута отмены нет; но маршрут
    # возьмёт номер ревизии из адреса, и без этой проверки это ровно
    # межарендная запись: чужая ревизия применилась бы к своему проекту.
    if revision.project_id != project.id:
        raise NotFoundInProject("revision_not_found", "ревизия не найдена в этом проекте")
    return apply_op(db, project, _op_from_dict(revision.inverse), actor_id=actor_id)
