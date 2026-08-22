# План 0: чего не хватает бэкенду — план реализации

> **Historical.** This is one of the original build plans this codebase
> was built from — every step below has since shipped. It reflects the plan
> as scoped in August 2026, not necessarily today's implementation; for
> current architecture and conventions, see the repo's `CLAUDE.md` and the
> `planora-conventions` skill. Kept as a build-history record, not an active
> task list.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть разрыв между тем, что умеет бэкенд сейчас, и тем, что понадобится интерфейсу: недостающие операции, перестановка строк с журналируемыми сдвигами, связи между задачами, список участников организации и устранение двух известных долгов.

**Architecture:** Ничего нового не проектируется. Все изменения ложатся в существующие модули: операции — в `app/mutations.py` по образцу шести уже написанных, чтение — в `app/api/project_routes.py`. Каждая операция обязана возвращать обратную себе; каждая ошибка — принадлежать одному из двух классов, `NotFoundInProject` или `InvalidOperation`.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, pytest. Как в плане 1.

## Global Constraints

- Каждая операция производит обратную себе. Это не опционально ни для одной.
- Журнал хранит событие с параметрами, а не готовую фразу: текст собирается при показе на языке читателя.
- Публичный контракт мутации отделён от внутреннего представления. Поля восстановления (`task_id`, `category_id`, `position`) существуют только во внутренних моделях и не принимаются по проводу.
- Ошибки наружу — машинными кодами в `detail`, никакой прозы. `NotFoundInProject` → 404, `InvalidOperation` → 422.
- Решения о доступе принимает только `app/access.py`. Маршрут спрашивает `can()`, а не сравнивает роли.
- Чужой проект неотличим от несуществующего: 404, никогда 403.
- Все изменения данных проекта идут через `apply_op`, внутри блокировки строки проекта.
- Разрушающие операции с базой — только по базе с суффиксом `_test`, никогда по названной в `DATABASE_URL`.
- Даты считаются только через `app/calendar.py`. Календарной арифметики в других модулях нет.

---

### Task 1: Операции правки полей задачи и категории

**Files:**
- Modify: `backend/app/mutations.py`
- Test: `backend/tests/test_mutations.py`

**Interfaces:**
- Consumes: существующий реестр операций, `MutationError`, `NotFoundInProject`, `InvalidOperation`, `_require_task`, `_require_category`.
- Produces: внутренние модели `SetTaskFields`, `SetCriticality`, `SetProgress`, `RenameCategory`, `SetCategoryColor` и соответствующие публичные модели в реестре `PublicOp`.

Каждая операция несёт прежнее и новое значение (`from` / `to`), как уже сделано в `move_task` и `set_duration`. Обратная операция получается перестановкой этих двух полей — не пишите отдельную ветку для инверсии.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `backend/tests/test_mutations.py`:

```python
def test_set_task_fields_records_previous_and_new_values(db, project, category):
    created = apply_op(db, project, CreateTask(
        category_id=str(category.id), name="Logo",
        start_date=date(2026, 3, 4), duration_days=5), actor_id=None)
    task_id = created.op["task_id"]

    revision = apply_op(db, project, SetTaskFields(
        task_id=task_id, name="Logo redesign",
        description="Mark and wordmark", internal_note="client is picky"), actor_id=None)

    assert revision.op["from"] == {
        "name": "Logo", "description": "", "internal_note": ""}
    assert revision.op["to"] == {
        "name": "Logo redesign", "description": "Mark and wordmark",
        "internal_note": "client is picky"}
    assert revision.inverse["to"] == revision.op["from"]

    task = db.get(Task, task_id)
    assert task.name == "Logo redesign"


def test_undo_of_set_task_fields_restores_every_field(db, project, category):
    created = apply_op(db, project, CreateTask(
        category_id=str(category.id), name="Logo",
        start_date=date(2026, 3, 4), duration_days=5,
        description="old", internal_note="old note"), actor_id=None)
    task_id = created.op["task_id"]

    changed = apply_op(db, project, SetTaskFields(
        task_id=task_id, name="New", description="new", internal_note="new note"),
        actor_id=None)
    undo(db, project, changed, actor_id=None)

    task = db.get(Task, task_id)
    assert (task.name, task.description, task.internal_note) == ("Logo", "old", "old note")


def test_set_progress_rejects_a_value_outside_the_range(db, project, category):
    created = apply_op(db, project, CreateTask(
        category_id=str(category.id), name="Logo",
        start_date=date(2026, 3, 4), duration_days=5), actor_id=None)

    with pytest.raises(InvalidOperation):
        apply_op(db, project, SetProgress(task_id=created.op["task_id"], progress_pct=101),
                 actor_id=None)


def test_rename_category_round_trips(db, project, category):
    revision = apply_op(db, project, RenameCategory(
        category_id=str(category.id), name="Дизайн и бренд"), actor_id=None)
    assert db.get(Category, category.id).name == "Дизайн и бренд"

    undo(db, project, revision, actor_id=None)
    assert db.get(Category, category.id).name == "Design"


def test_set_criticality_rejects_an_unknown_level(db, project, category):
    created = apply_op(db, project, CreateTask(
        category_id=str(category.id), name="Logo",
        start_date=date(2026, 3, 4), duration_days=5), actor_id=None)

    with pytest.raises(InvalidOperation):
        apply_op(db, project, SetCriticality(
            task_id=created.op["task_id"], criticality="urgent"), actor_id=None)
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
cd backend && uv run pytest tests/test_mutations.py -k "set_task_fields or set_progress or rename_category or set_criticality" -v
```

Ожидается: `ImportError` — новых имён в `app.mutations` нет.

- [ ] **Step 3: Добавить внутренние модели и ветки применения**

В `backend/app/mutations.py` рядом с существующими операциями. `SetTaskFields` меняет три текстовых поля разом, потому что карточка задачи сохраняет их одним действием и разбивать это на три ревизии значило бы засорять историю:

```python
class SetTaskFields(BaseModel):
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
```

Ветки применения. Обратите внимание: инверсия строится перестановкой `from` и `to`, единым помощником, а не копипастой в каждой ветке:

```python
_TASK_FIELDS = ("name", "description", "internal_note")


def _swap(payload: dict) -> dict:
    """Обратная операция отличается от прямой только местами from и to."""
    return {**payload, "from": payload["to"], "to": payload["from"]}


# внутри _apply:
    if isinstance(op, SetTaskFields):
        task = _require_task(db, project, op.task_id)
        before = {field: getattr(task, field) for field in _TASK_FIELDS}
        after = {"name": op.name, "description": op.description,
                 "internal_note": op.internal_note}
        for field, value in after.items():
            setattr(task, field, value)
        db.flush()
        forward = {"type": "set_task_fields", "task_id": str(task.id),
                   "from": before, "to": after}
        return forward, _swap(forward)

    if isinstance(op, SetCriticality):
        if op.criticality not in CRITICALITY_LEVELS:
            raise InvalidOperation("unknown_criticality", f"неизвестный уровень: {op.criticality}")
        task = _require_task(db, project, op.task_id)
        forward = {"type": "set_criticality", "task_id": str(task.id),
                   "from": task.criticality, "to": op.criticality}
        task.criticality = op.criticality
        db.flush()
        return forward, _swap(forward)

    if isinstance(op, SetProgress):
        if not 0 <= op.progress_pct <= 100:
            raise InvalidOperation("progress_out_of_range", f"процент вне 0..100: {op.progress_pct}")
        task = _require_task(db, project, op.task_id)
        forward = {"type": "set_progress", "task_id": str(task.id),
                   "from": task.progress_pct, "to": op.progress_pct}
        task.progress_pct = op.progress_pct
        db.flush()
        return forward, _swap(forward)

    if isinstance(op, RenameCategory):
        category = _require_category(db, project, op.category_id)
        forward = {"type": "rename_category", "category_id": str(category.id),
                   "from": category.name, "to": op.name}
        category.name = op.name
        db.flush()
        return forward, _swap(forward)

    if isinstance(op, SetCategoryColor):
        category = _require_category(db, project, op.category_id)
        forward = {"type": "set_category_color", "category_id": str(category.id),
                   "from": category.color, "to": op.color}
        category.color = op.color
        db.flush()
        return forward, _swap(forward)
```

Определить рядом с классом критичности:

```python
CRITICALITY_LEVELS = ("low", "normal", "high", "critical")
```

- [ ] **Step 4: Научить `_op_from_dict` читать новые записи**

Все пять операций хранят обе границы, поэтому восстановление берёт `to` — ровно как уже сделано для `move_task` и `set_duration`. Дописать в отображение:

```python
_MODELS.update({
    "set_task_fields": SetTaskFields,
    "set_criticality": SetCriticality,
    "set_progress": SetProgress,
    "rename_category": RenameCategory,
    "set_category_color": SetCategoryColor,
})
```

И в `_op_from_dict` расширить разбор: для `set_task_fields` поля берутся из вложенного словаря `to`, для остальных четырёх — скалярное `to` кладётся в соответствующее поле модели. Напишите это явным отображением «тип операции → имя поля», а не цепочкой `elif`: цепочка растёт вместе с числом операций и перестаёт читаться.

- [ ] **Step 5: Добавить публичные модели**

В блок публичных моделей (`_Wire` с `extra="forbid"`) добавить пять зеркал с ограничениями: длины полей из колонок (`name` 300, `description` и `internal_note` — `_MAX_TEXT_LEN`, `name` категории 200, `color` 9), `criticality` через перечисление, `progress_pct` в диапазоне 0–100. Публичные модели не содержат ничего сверх того, что человек вправе прислать.

- [ ] **Step 6: Прогнать тесты**

```bash
cd backend && uv run pytest tests/test_mutations.py -v
```

Ожидается: все тесты модуля зелёные, включая прежние.

- [ ] **Step 7: Закоммитить**

```bash
git add backend/app/mutations.py backend/tests/test_mutations.py
git commit -m "feat: операции правки полей задачи и категории"
```

---

### Task 2: Перестановка строк со сдвигом соседей

**Files:**
- Modify: `backend/app/mutations.py`
- Test: `backend/tests/test_mutations.py`

**Interfaces:**
- Produces: операция `ReorderTask(task_id, category_id, position)` — переносит задачу в указанную категорию на указанную позицию, раздвигая соседей.

Это долг, оставленный планом 1, и главная причина, по которой он оставлен: **сдвиги соседей обязаны попасть в журнал**. Если подвинуть соседей молча, отмена вернёт саму задачу, а соседи останутся сдвинутыми — порядок разъедется, и виноватого в истории не найти.

Решение: одна ревизия несёт полную карту позиций до и после. Обратная операция — та же карта, перевёрнутая. Это дороже по объёму записи, чем «сдвинуть задачу с A на B», но единственный способ, при котором отмена честна.

- [ ] **Step 1: Написать падающие тесты**

```python
def _positions(db, project) -> dict[str, int]:
    rows = db.scalars(select(Task).where(Task.project_id == project.id)).all()
    return {str(row.id): row.position for row in rows}


def test_reorder_shifts_neighbours_and_records_the_whole_map(db, project, category):
    ids = [apply_op(db, project, CreateTask(
        category_id=str(category.id), name=f"T{i}",
        start_date=date(2026, 3, 4), duration_days=1), actor_id=None).op["task_id"]
        for i in range(3)]

    revision = apply_op(db, project, ReorderTask(
        task_id=ids[2], category_id=str(category.id), position=0), actor_id=None)

    after = _positions(db, project)
    assert after[ids[2]] == 0
    assert after[ids[0]] == 1
    assert after[ids[1]] == 2
    # в журнале лежит карта, а не один сдвиг
    assert set(revision.op["from"]) == set(ids)
    assert revision.op["to"][ids[0]] == 1


def test_undo_of_a_reorder_restores_every_neighbour(db, project, category):
    ids = [apply_op(db, project, CreateTask(
        category_id=str(category.id), name=f"T{i}",
        start_date=date(2026, 3, 4), duration_days=1), actor_id=None).op["task_id"]
        for i in range(3)]
    before = _positions(db, project)

    revision = apply_op(db, project, ReorderTask(
        task_id=ids[2], category_id=str(category.id), position=0), actor_id=None)
    undo(db, project, revision, actor_id=None)

    assert _positions(db, project) == before


def test_reorder_into_another_category_moves_and_renumbers(db, project, category):
    other = db.get(Category, apply_op(db, project, CreateCategory(
        name="Development", color="#22c55e"), actor_id=None).op["category_id"])
    task_id = apply_op(db, project, CreateTask(
        category_id=str(category.id), name="Logo",
        start_date=date(2026, 3, 4), duration_days=1), actor_id=None).op["task_id"]

    apply_op(db, project, ReorderTask(
        task_id=task_id, category_id=str(other.id), position=0), actor_id=None)

    task = db.get(Task, task_id)
    assert task.category_id == other.id
    assert task.position == 0


def test_reorder_rejects_a_category_from_another_project(db, project, category, other_project_category):
    task_id = apply_op(db, project, CreateTask(
        category_id=str(category.id), name="Logo",
        start_date=date(2026, 3, 4), duration_days=1), actor_id=None).op["task_id"]

    with pytest.raises(NotFoundInProject):
        apply_op(db, project, ReorderTask(
            task_id=task_id, category_id=str(other_project_category.id), position=0),
            actor_id=None)
```

Фикстуру `other_project_category` добавить рядом с существующими: вторая организация, её проект, её категория.

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
cd backend && uv run pytest tests/test_mutations.py -k reorder -v
```

Ожидается: `ImportError: cannot import name 'ReorderTask'`.

- [ ] **Step 3: Реализовать операцию**

```python
class ReorderTask(BaseModel):
    type: Literal["reorder_task"] = "reorder_task"
    task_id: uuid.UUID
    category_id: uuid.UUID
    position: int


class ApplyPositions(BaseModel):
    """Внутренняя операция: расставить позиции по готовой карте.

    Существует только как обратная к reorder_task. По проводу не принимается —
    в публичном реестре её нет.
    """
    type: Literal["apply_positions"] = "apply_positions"
    positions: dict[uuid.UUID, int]
    categories: dict[uuid.UUID, uuid.UUID]
```

Ветка применения:

```python
    if isinstance(op, ReorderTask):
        if op.position < 0:
            raise InvalidOperation("negative_position", "позиция не может быть отрицательной")
        task = _require_task(db, project, op.task_id)
        _require_category(db, project, op.category_id)

        rows = db.scalars(
            select(Task).where(Task.project_id == project.id).order_by(Task.position, Task.id)
        ).all()
        before_pos = {str(row.id): row.position for row in rows}
        before_cat = {str(row.id): str(row.category_id) for row in rows}

        siblings = [row for row in rows
                    if row.category_id == op.category_id and row.id != task.id]
        index = min(op.position, len(siblings))
        ordered = siblings[:index] + [task] + siblings[index:]

        task.category_id = op.category_id
        for slot, row in enumerate(ordered):
            row.position = slot
        db.flush()

        after_pos = {str(row.id): row.position for row in rows}
        after_cat = {str(row.id): str(row.category_id) for row in rows}
        forward = {"type": "reorder_task", "task_id": str(task.id),
                   "from": before_pos, "to": after_pos,
                   "categories_from": before_cat, "categories_to": after_cat}
        inverse = {"type": "apply_positions",
                   "positions": before_pos, "categories": before_cat}
        return forward, inverse

    if isinstance(op, ApplyPositions):
        before_pos, before_cat = {}, {}
        for raw_id, position in op.positions.items():
            row = _require_task(db, project, raw_id)
            before_pos[str(row.id)] = row.position
            before_cat[str(row.id)] = str(row.category_id)
            row.position = position
            row.category_id = op.categories[raw_id]
        db.flush()
        forward = {"type": "apply_positions",
                   "positions": {k: v for k, v in op.positions.items()},
                   "categories": {k: v for k, v in op.categories.items()}}
        inverse = {"type": "apply_positions",
                   "positions": before_pos, "categories": before_cat}
        return forward, inverse
```

Зарегистрировать обе в `_MODELS`; в публичный реестр добавить **только** `ReorderTask`.

- [ ] **Step 4: Прогнать тесты**

```bash
cd backend && uv run pytest tests/test_mutations.py -k reorder -v
```

Ожидается: 4 passed.

- [ ] **Step 5: Прогнать весь набор — перестановка трогает позиции, которые проверяют другие тесты**

```bash
cd backend && uv run pytest -q
```

- [ ] **Step 6: Закоммитить**

```bash
git add backend/app/mutations.py backend/tests/test_mutations.py
git commit -m "feat: перестановка строк со сдвигом соседей в журнале"
```

---

### Task 3: Связи между задачами

**Files:**
- Modify: `backend/app/mutations.py`
- Test: `backend/tests/test_mutations.py`

**Interfaces:**
- Produces: `AddDependency(from_task_id, to_task_id)`, `RemoveDependency(from_task_id, to_task_id)`.

Связи по спеку — стрелки на картинке, а не правило расчёта: даты по ним не пересчитываются. Но мусор в них допускать нельзя.

- [ ] **Step 1: Написать падающие тесты**

```python
def test_dependency_round_trips(db, project, category):
    a, b = [apply_op(db, project, CreateTask(
        category_id=str(category.id), name=n,
        start_date=date(2026, 3, 4), duration_days=1), actor_id=None).op["task_id"]
        for n in ("A", "B")]

    added = apply_op(db, project, AddDependency(from_task_id=a, to_task_id=b), actor_id=None)
    assert db.scalar(select(func.count()).select_from(Dependency)) == 1

    undo(db, project, added, actor_id=None)
    assert db.scalar(select(func.count()).select_from(Dependency)) == 0


def test_a_task_cannot_depend_on_itself(db, project, category):
    a = apply_op(db, project, CreateTask(
        category_id=str(category.id), name="A",
        start_date=date(2026, 3, 4), duration_days=1), actor_id=None).op["task_id"]

    with pytest.raises(InvalidOperation):
        apply_op(db, project, AddDependency(from_task_id=a, to_task_id=a), actor_id=None)


def test_the_same_dependency_cannot_be_added_twice(db, project, category):
    a, b = [apply_op(db, project, CreateTask(
        category_id=str(category.id), name=n,
        start_date=date(2026, 3, 4), duration_days=1), actor_id=None).op["task_id"]
        for n in ("A", "B")]
    apply_op(db, project, AddDependency(from_task_id=a, to_task_id=b), actor_id=None)

    with pytest.raises(InvalidOperation):
        apply_op(db, project, AddDependency(from_task_id=a, to_task_id=b), actor_id=None)


def test_removing_a_dependency_that_does_not_exist_is_refused(db, project, category):
    a, b = [apply_op(db, project, CreateTask(
        category_id=str(category.id), name=n,
        start_date=date(2026, 3, 4), duration_days=1), actor_id=None).op["task_id"]
        for n in ("A", "B")]

    with pytest.raises(NotFoundInProject):
        apply_op(db, project, RemoveDependency(from_task_id=a, to_task_id=b), actor_id=None)
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
cd backend && uv run pytest tests/test_mutations.py -k dependency -v
```

- [ ] **Step 3: Реализовать**

Обе задачи проверяются через `_require_task`, поэтому связь с чужой задачей отсекается тем же механизмом, что и всё остальное. Обратная к `add_dependency` — `remove_dependency` с теми же концами, и наоборот.

- [ ] **Step 4: Прогнать тесты и закоммитить**

```bash
cd backend && uv run pytest tests/test_mutations.py -k dependency -v
git add backend/app/mutations.py backend/tests/test_mutations.py
git commit -m "feat: связи между задачами как визуальные стрелки"
```

---

### Task 4: Назначение исполнителей и список участников

**Files:**
- Modify: `backend/app/mutations.py`
- Modify: `backend/app/api/project_routes.py`
- Create: `backend/app/api/org_routes.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_mutations.py`, `backend/tests/test_org_api.py`

**Interfaces:**
- Produces: операции `AssignUser(task_id, user_id)`, `UnassignUser(task_id, user_id)`; маршрут `GET /api/org/members`.

Интерфейсу нужен список людей, которых можно назначить. Он же понадобится плану 5 для приглашений.

- [ ] **Step 1: Написать падающие тесты**

```python
def test_assigning_a_user_from_another_organization_is_refused(db, project, category, outsider):
    task_id = apply_op(db, project, CreateTask(
        category_id=str(category.id), name="Logo",
        start_date=date(2026, 3, 4), duration_days=1), actor_id=None).op["task_id"]

    with pytest.raises(InvalidOperation):
        apply_op(db, project, AssignUser(task_id=task_id, user_id=str(outsider.id)),
                 actor_id=None)
```

```python
def test_members_lists_only_this_organization(authed, db):
    from app.auth import register
    stranger = register(db, name="Stranger", email="stranger@example.com", password="s3cret-pass")
    db.flush()

    response = authed.get("/api/org/members")
    assert response.status_code == 200
    emails = [m["email"] for m in response.json()]
    assert "stranger@example.com" not in emails


def test_members_requires_authentication(client):
    assert client.get("/api/org/members").status_code == 401
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

```bash
cd backend && uv run pytest tests/test_org_api.py tests/test_mutations.py -k "assign or members" -v
```

- [ ] **Step 3: Реализовать операции**

Назначение проверяет, что пользователь состоит в той же организации, что и проект: иначе задачу можно повесить на постороннего и утечёт факт его существования. Проверка — запросом к `Membership` по `org_id` проекта.

Обратная к `assign_user` — `unassign_user` с теми же аргументами. Повторное назначение того же человека отвергается как `InvalidOperation`, снятие несуществующего — как `NotFoundInProject`.

- [ ] **Step 4: Реализовать маршрут участников**

Создать `backend/app/api/org_routes.py` с единственным маршрутом `GET /api/org/members`, возвращающим `id`, `name`, `email` и роль участников организации текущего пользователя. Доступ — через `access.can(..., Action.PROJECT_READ)`; роль `client` список участников не получает вовсе (по спеку она не видит состав организации), поэтому для неё маршрут отвечает 403.

Подключить роутер в `app/main.py`.

- [ ] **Step 5: Прогнать тесты и закоммитить**

```bash
cd backend && uv run pytest -q
git add backend/app/mutations.py backend/app/api/ backend/app/main.py backend/tests/
git commit -m "feat: назначение исполнителей и список участников организации"
```

---

### Task 5: Полное состояние проекта для интерфейса

**Files:**
- Modify: `backend/app/api/project_routes.py`
- Test: `backend/tests/test_project_api.py`

**Interfaces:**
- Produces: расширенный ответ `GET /api/projects/{id}` — задачи с исполнителями, связи, настройки проекта, разрешённые из организации.

Сейчас ответ не содержит ни исполнителей, ни связей, ни календаря — а интерфейсу нужно нарисовать выходные и залить нерабочие дни ещё до первого клика.

- [ ] **Step 1: Написать падающие тесты**

```python
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
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

- [ ] **Step 3: Расширить сериализацию**

Добавить в ответ: `assignee_ids` у каждой задачи (одним запросом на весь проект, не по задаче — иначе на сотне задач получится сотня запросов), список `dependencies`, блок `calendar` с разрешённой маской рабочих дней и списками нерабочих и рабочих исключений, блок `settings` с разрешённым порогом и таймзоной, `deadline` и вычисленный `project_end` — максимум по датам окончания задач или `null`, если задач нет.

Внутренняя заметка по-прежнему проходит через `access`, а не через инлайновую проверку.

- [ ] **Step 4: Прогнать тесты и закоммитить**

```bash
cd backend && uv run pytest tests/test_project_api.py -v
git add backend/app/api/project_routes.py backend/tests/test_project_api.py
git commit -m "feat: полное состояние проекта для интерфейса"
```

---

### Task 6: Два долга плана 1

**Files:**
- Modify: `backend/app/calendar.py`
- Modify: `backend/app/api/project_routes.py`
- Test: `backend/tests/test_calendar.py`, `backend/tests/test_project_api.py`

**Interfaces:**
- Меняется поведение при вырожденном календаре: вместо 500 — понятный отказ.

Финальное ревью плана 1 оставило это наблюдением: `end_date` поднимает голый `ValueError`, и проект с нулевой маской рабочих дней отвечает 500 на чтение. Настройка приходит от человека, значит уронить сервер может человек.

- [ ] **Step 1: Написать падающие тесты**

```python
def test_reading_a_project_with_no_working_days_explains_itself(authed, db):
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
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает с 500**

```bash
cd backend && uv run pytest tests/test_project_api.py -k no_working_days -v
```

Ожидается: 500 вместо 422 — ровно то поведение, которое чиним.

- [ ] **Step 3: Ввести отдельный класс ошибки календаря**

В `app/calendar.py` определить `CalendarError(ValueError)` с полем `code` и поднимать его вместо голого `ValueError` в обеих точках. Маршрут ловит его и отвечает 422 с машинным кодом — той же формы, что и остальные отказы.

- [ ] **Step 4: Прогнать весь набор**

```bash
cd backend && uv run pytest -q
```

- [ ] **Step 5: Закоммитить**

```bash
git add backend/app/calendar.py backend/app/api/project_routes.py backend/tests/
git commit -m "fix: вырожденный календарь объясняет себя вместо пятисотки"
```

---

## Что этот план не делает

- Утверждение плана, baseline и порог с причиной — план 3 исходной декомпозиции, после фронта.
- WebSocket, публичные ссылки, комментарии, приглашения, AI — планы 4–6.
- Эндпоинт отмены. Механизм `undo` реализован и покрыт тестами, но наружу не выведен: первым его потребителем станет откат пачки от AI, и удобнее спроектировать маршрут тогда, когда известен этот сценарий.
