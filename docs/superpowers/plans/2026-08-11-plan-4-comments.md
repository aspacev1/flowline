# План 4: комментарии — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать проекту и задаче обсуждение: участник пишет реплику, все, кто видит проект, её читают.

**Architecture:** Комментарий — не операция. Он не меняет план, не отменяется и не попадает в журнал ревизий: собственный ресурс со своими маршрутами (`GET`/`POST /api/projects/{id}/comments`) и собственной таблицей. Право писать спрашивается у той же матрицы (`Action.COMMENT`), что уже описывает роли, — второго списка ролей не заводится. Модель сразу несёт поля гостя (`guest_name` вместо `author_user_id`), потому что таблица переживёт появление публичных ссылок, а миграция ради одной колонки потом — лишняя работа.

**Tech Stack:** Как в планах 0–3. Никаких новых зависимостей.

## Global Constraints

- Комментарии не проходят через `apply_op` и не создают ревизий. Отмены у них нет.
- Право читать проект — `Action.PROJECT_READ`, право писать реплику — `Action.COMMENT`. Роль спрашивается у `app.access`, а не сравнивается со строкой.
- Тело комментария — содержимое пользователя: хранится как введено и не переводится никогда.
- Отказы сервера — машинный код в `detail`, без прозы. Клиент переводит код словарём.
- Языки: `az` по умолчанию, `en`, `ru`. Ключ обязан появиться во всех трёх словарях — иначе падает тест полноты словарей.
- Свой CSS с переменными и тёмной темой, `prefers-reduced-motion` уважается.
- Гость по публичной ссылке в этот план не входит: модели `ShareLink` в схеме нет, а без неё гостя нечем опознать. Таблица к нему готова (`author_user_id` и `guest_name` — nullable), маршрут — нет. `GUEST_COMMENT_RATE_LIMIT` останется неиспользованным до плана публичных ссылок; вводить ограничитель раньше пути, который он ограничивает, значит писать код без вызывающего.

## Файлы

| Файл | Ответственность |
|---|---|
| `backend/app/models.py` | Таблица `comments` с ограничением «ровно один автор» |
| `backend/migrations/versions/*_comments.py` | Миграция схемы |
| `backend/app/comments.py` | Домен: добавить реплику, прочитать ветку. Знает про пустое тело и чужую задачу |
| `backend/app/api/project_routes.py` | Два маршрута ресурса — рядом с ревизиями и мутациями, на тех же помощниках доступа |
| `frontend/src/api/comments.ts` | Типы провода и два вызова |
| `frontend/src/task/Comments.tsx` | Ветка обсуждения на карточке задачи |
| `frontend/src/task/panel.css` | Оформление ветки |
| `frontend/src/i18n/{az,en,ru}.json` | Подписи и объяснение отказа |
| `frontend/src/api/errors.ts` | Новый код отказа в списке переводимых |

---

### Task 1: Таблица комментариев

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/migrations/versions/<hash>_comments.py` (генерируется alembic)
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces: `Comment` с полями `id`, `project_id`, `task_id`, `author_user_id`, `guest_name`, `body`, `created_at`.

Автор бывает двух видов и ровно одного за раз: участник с аккаунтом (`author_user_id`) или гость по имени (`guest_name`). Обе колонки nullable, поэтому «ровно один» — это CHECK в базе, а не договорённость в коде: пишущих в таблицу будет больше одного (маршрут участника сегодня, маршрут гостя после публичных ссылок), и договорённость они однажды прочтут по-разному.

- [x] **Step 1: Написать падающий тест**

В `backend/tests/test_models.py`, в конец файла:

```python
def test_comment_has_exactly_one_kind_of_author(db):
    """Автор либо участник, либо гость — и никогда оба сразу или ни одного.

    Обе колонки nullable по отдельности, поэтому «ровно один» держит только
    CHECK. Без него запись без автора вообще проходит в таблицу и всплывает
    в ленте пустой подписью.
    """
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    project = Project(org_id=org.id, name="Redesign", slug="redesign")
    db.add(project)
    db.flush()
    user = User(email="a@b.c", password_hash=hash_password("s3cret-pass"), name="Alex")
    db.add(user)
    db.flush()

    db.add(Comment(project_id=project.id, author_user_id=user.id, body="ok"))
    db.flush()

    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.add(Comment(project_id=project.id, body="ничей"))
            db.flush()

    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.add(
                Comment(
                    project_id=project.id,
                    author_user_id=user.id,
                    guest_name="Гость",
                    body="оба сразу",
                )
            )
            db.flush()


def test_comment_without_a_task_belongs_to_the_project(db):
    """task_id nullable: реплика бывает к проекту целиком, а не к строке."""
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    project = Project(org_id=org.id, name="Redesign", slug="redesign")
    db.add(project)
    db.flush()

    comment = Comment(project_id=project.id, guest_name="Гость", body="привет")
    db.add(comment)
    db.flush()

    assert comment.task_id is None
    assert comment.created_at is not None
```

Импорт в шапке файла дополнить: `Comment` в списке из `app.models`.

- [x] **Step 2: Убедиться, что тест падает**

```bash
cd backend && uv run pytest tests/test_models.py -q
```

Ожидается: `ImportError: cannot import name 'Comment' from 'app.models'`.

- [x] **Step 3: Добавить модель**

В `backend/app/models.py`, после `Revision`:

```python
class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (
        # Ровно один автор. Обе колонки nullable по отдельности — гость
        # подписан именем, участник ссылкой на аккаунт, — и без этого
        # ограничения в таблицу проходит реплика вообще без подписи.
        CheckConstraint(
            "(author_user_id IS NULL) <> (guest_name IS NULL)",
            name="ck_comments_single_author",
        ),
        # Ветку читают целиком и всегда в одном и том же порядке: проект или
        # задача, дальше по времени. Составной индекс отвечает на этот запрос
        # один; два отдельных по колонкам заставили бы сортировать выборку.
        Index("ix_comments_thread", "project_id", "task_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    # null — реплика к проекту целиком, а не к строке.
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    # Без ondelete: SET NULL оставил бы запись без обоих видов автора и
    # нарушил бы CHECK выше, а CASCADE стёр бы чужую переписку заодно с
    # аккаунтом. Удаление автора, у которого есть реплики, должно упасть
    # громко — сегодня людей не удаляют вовсе.
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    guest_name: Mapped[str | None] = mapped_column(String(100))
    body: Mapped[str] = mapped_column(Text)
    # clock_timestamp(), а не now(): now() — это время начала транзакции, одно
    # на все записи внутри неё. Комментарии — единственные строки, чей порядок
    # чтения и есть порядок записи, и на одинаковых отметках он разваливается
    # в случайный порядок идентификаторов. У ревизий ту же работу делает seq.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
```

> Правка по ходу исполнения: сначала здесь стоял `func.now()`, как у остальных
> таблиц. Тест порядка ленты (Task 2) его и поймал — три реплики одной
> транзакции получили одинаковую отметку и легли в порядке случайных UUID.

В импорт `sqlalchemy` добавить `Index`.

- [x] **Step 4: Убедиться, что тест проходит**

```bash
cd backend && uv run pytest tests/test_models.py -q
```

Ожидается: PASS. (Тесты создают схему из метаданных, миграции им не нужны.)

- [x] **Step 5: Сгенерировать миграцию**

```bash
cd backend && uv run alembic revision --autogenerate -m "comments"
```

Открыть получившийся файл и убедиться, что в `upgrade()` только `create_table('comments')` с индексом и CHECK — ничего постороннего. Лишнее из автогенерации удалить.

- [x] **Step 6: Прогнать миграцию и весь бэкенд**

```bash
cd backend && uv run alembic upgrade head && uv run pytest -q
```

Ожидается: миграция применяется, 158 тестов проходят.

- [x] **Step 7: Коммит**

```bash
git add backend/app/models.py backend/migrations backend/tests/test_models.py
git commit -m "feat: таблица комментариев"
```

---

### Task 2: Домен комментариев

**Files:**
- Create: `backend/app/comments.py`
- Test: `backend/tests/test_comments.py`

**Interfaces:**
- Consumes: `Comment` из Task 1.
- Produces:
  - `add_comment(db, project, *, body, task_id=None, author=None, guest_name=None) -> Comment`
  - `list_comments(db, project, *, task_id=None, limit=200) -> list[Comment]`
  - `CommentRefused(code, message)` и `TaskNotInProject(CommentRefused)`.

Домен отдельно от маршрута по той же причине, что и `mutations.py`: правила «пустая реплика не реплика» и «чужая задача — не задача этого проекта» проверяются тестом на функции, а не поднятым HTTP-клиентом.

Порядок ленты — от старых к новым, в отличие от журнала ревизий. Журнал читают с последнего события, разговор — сверху вниз; переворачивать его в браузере значило бы держать порядок в двух местах.

- [x] **Step 1: Написать падающие тесты**

Создать `backend/tests/test_comments.py`:

```python
import pytest

from app.comments import CommentRefused, TaskNotInProject, add_comment, list_comments
from app.models import Category, Organization, Project, Task, User
from app.security import hash_password


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
def author(db):
    user = User(email="a@b.c", password_hash=hash_password("s3cret-pass"), name="Alex")
    db.add(user)
    db.flush()
    return user


def _task(db, project) -> Task:
    from datetime import date

    category = Category(project_id=project.id, name="Design", color="#3b82f6", position=0)
    db.add(category)
    db.flush()
    task = Task(
        project_id=project.id,
        category_id=category.id,
        name="Логотип",
        start_date=date(2026, 3, 4),
        duration_days=5,
    )
    db.add(task)
    db.flush()
    return task


def test_reply_keeps_the_text_as_it_was_written(db, project, author):
    """Тело — содержимое пользователя: ни перевода, ни переформатирования."""
    comment = add_comment(db, project, body="  Согласовано с клиентом  ", author=author)

    assert comment.body == "Согласовано с клиентом"
    assert comment.author_user_id == author.id
    assert comment.guest_name is None
    assert comment.task_id is None


def test_empty_reply_is_refused(db, project, author):
    """Пробелы — не реплика. Иначе в ленте появляются пустые строки, которые
    нельзя ни прочитать, ни удалить."""
    with pytest.raises(CommentRefused) as refusal:
        add_comment(db, project, body="   \n  ", author=author)

    assert refusal.value.code == "comment_empty"


def test_reply_to_a_task_of_another_project_is_refused(db, project, author):
    """Задача чужого проекта — не задача этого. Без проверки реплика уезжает
    в чужую ленту, и увидит её тот, кому чужой проект не показывают."""
    other = Project(org_id=project.org_id, name="Other", slug="other")
    db.add(other)
    db.flush()
    stranger = _task(db, other)

    with pytest.raises(TaskNotInProject) as refusal:
        add_comment(db, project, body="сюда", task_id=stranger.id, author=author)

    assert refusal.value.code == "task_not_found"


def test_thread_reads_from_older_to_newer(db, project, author):
    """Разговор читают сверху вниз, в отличие от журнала ревизий."""
    for text in ("первое", "второе", "третье"):
        add_comment(db, project, body=text, author=author)

    assert [c.body for c in list_comments(db, project)] == ["первое", "второе", "третье"]


def test_task_thread_and_project_thread_do_not_mix(db, project, author):
    """Реплика к строке не всплывает в обсуждении проекта целиком, и наоборот:
    иначе карточка задачи показывает всё подряд."""
    task = _task(db, project)
    add_comment(db, project, body="о проекте", author=author)
    add_comment(db, project, body="о задаче", task_id=task.id, author=author)

    assert [c.body for c in list_comments(db, project)] == ["о проекте"]
    assert [c.body for c in list_comments(db, project, task_id=task.id)] == ["о задаче"]


def test_guest_signs_with_a_name(db, project):
    """Гость по ссылке подписан именем, а не аккаунтом. Маршрута к нему ещё
    нет, но домен обязан уметь его записать — иначе публичные ссылки начнут
    с переписывания этого модуля."""
    comment = add_comment(db, project, body="а когда сдача?", guest_name="Мария")

    assert comment.guest_name == "Мария"
    assert comment.author_user_id is None


def test_reply_without_any_author_is_refused(db, project):
    """Ни аккаунта, ни имени — подписать реплику нечем."""
    with pytest.raises(CommentRefused) as refusal:
        add_comment(db, project, body="аноним")

    assert refusal.value.code == "comment_author_required"
```

- [x] **Step 2: Убедиться, что тесты падают**

```bash
cd backend && uv run pytest tests/test_comments.py -q
```

Ожидается: `ModuleNotFoundError: No module named 'app.comments'`.

- [x] **Step 3: Написать модуль**

Создать `backend/app/comments.py`:

```python
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.models import Comment, Project, Task, User

# Тот же потолок, что и у остальных длинных текстов приложения. Отдельной
# настройки для комментария не заводится: два потолка на одно и то же
# однажды разъедутся, и человек узнает об этом на длинной реплике.
MAX_COMMENT_LEN = get_settings().max_text_len


class CommentRefused(Exception):
    """Отказ записать реплику.

    Несёт машинный код для ответа и человеческий текст — для журнала. Той же
    формы, что и MutationError: сервер словарей сообщений не держит, и проза
    в `detail` была бы непереводима.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class TaskNotInProject(CommentRefused):
    """Задача не существует или принадлежит другому проекту.

    Отдельный класс, потому что маршрут отвечает на это 404, а на остальные
    отказы — 422: обращение к чужой строке не ошибка формата запроса.
    """


def add_comment(
    db: DbSession,
    project: Project,
    *,
    body: str,
    task_id: uuid.UUID | None = None,
    author: User | None = None,
    guest_name: str | None = None,
) -> Comment:
    """Реплика в обсуждение проекта или одной его задачи.

    Автор — участник или гость по имени, ровно один из двух: то же правило,
    что держит CHECK в таблице. Проверяется и здесь, чтобы отказ был кодом
    ответа, а не IntegrityError пятисоткой.
    """
    if (author is None) == (guest_name is None):
        raise CommentRefused("comment_author_required", "реплику нечем подписать")

    # Хвостовые пробелы и перевод строки от textarea — не текст. Обрезаются
    # до проверки на пустоту, иначе «   » проходит как реплика.
    text = body.strip()
    if not text:
        raise CommentRefused("comment_empty", "пустая реплика")

    if task_id is not None:
        task = db.get(Task, task_id)
        if task is None or task.project_id != project.id:
            raise TaskNotInProject("task_not_found", "задача не найдена в этом проекте")

    comment = Comment(
        project_id=project.id,
        task_id=task_id,
        author_user_id=author.id if author else None,
        guest_name=guest_name,
        body=text,
    )
    db.add(comment)
    db.flush()
    return comment


def list_comments(
    db: DbSession,
    project: Project,
    *,
    task_id: uuid.UUID | None = None,
    limit: int = 200,
) -> list[Comment]:
    """Ветка обсуждения: одной задачи или проекта целиком.

    От старых к новым — разговор читают сверху вниз. Журнал ревизий рядом
    отсортирован наоборот, и это не рассогласование: там читают последнее
    событие, здесь — нить с начала.

    `is_(None)`, а не `== None`: сравнение с None в SQL истинным не бывает, и
    ветка проекта молча оказалась бы пустой.
    """
    query = select(Comment).where(Comment.project_id == project.id)
    query = query.where(Comment.task_id == task_id if task_id is not None else Comment.task_id.is_(None))
    # id вторым ключом: две реплики одной миллисекунды по времени
    # неразличимы, и порядок между ними иначе решает планировщик.
    return list(db.scalars(query.order_by(Comment.created_at, Comment.id).limit(limit)).all())
```

- [x] **Step 4: Убедиться, что тесты проходят**

```bash
cd backend && uv run pytest tests/test_comments.py -q
```

Ожидается: 7 passed.

- [x] **Step 5: Коммит**

```bash
git add backend/app/comments.py backend/tests/test_comments.py
git commit -m "feat: домен комментариев"
```

---

### Task 3: Маршруты комментариев

**Files:**
- Modify: `backend/app/api/project_routes.py`
- Test: `backend/tests/test_comment_api.py`

**Interfaces:**
- Consumes: `add_comment`, `list_comments`, `CommentRefused`, `TaskNotInProject`, `MAX_COMMENT_LEN` из Task 2.
- Produces:
  - `GET /api/projects/{project_id}/comments?task_id=&limit=` → `[{id, task_id, body, created_at, author, guest_name}]`
  - `POST /api/projects/{project_id}/comments` с телом `{body, task_id?}` → 201, тот же объект.

Маршруты живут в `project_routes.py` рядом с ревизиями и мутациями, а не в своём файле: они — подресурс проекта и держатся на тех же `_load_project` и `_require_project_read`. Вынести их значило бы либо тащить приватных помощников через границу модуля, либо завести им вторую копию.

`author` в ответе — объект или `null`, как в ленте ревизий. Гость приходит `guest_name`-ом; интерфейс подписывает его иначе, и различить их обязан ответ, а не догадка по отсутствию поля.

- [x] **Step 1: Написать падающие тесты**

Создать `backend/tests/test_comment_api.py`:

```python
import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app


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
    response = authed.post(
        f"/api/projects/{project_id}/comments", json={"body": "Согласовано"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["body"] == "Согласовано"
    assert body["author"]["name"] == "Alex"
    assert body["guest_name"] is None
    assert body["task_id"] is None


def test_thread_of_a_task_is_separate_from_the_project_thread(authed, project_id):
    task_id = _task_id(authed, project_id)
    authed.post(f"/api/projects/{project_id}/comments", json={"body": "о проекте"})
    authed.post(
        f"/api/projects/{project_id}/comments", json={"body": "о задаче", "task_id": task_id}
    )

    of_task = authed.get(f"/api/projects/{project_id}/comments?task_id={task_id}").json()
    of_project = authed.get(f"/api/projects/{project_id}/comments").json()

    assert [c["body"] for c in of_task] == ["о задаче"]
    assert [c["body"] for c in of_project] == ["о проекте"]


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


def test_comments_require_a_session(client, authed, project_id):
    """Гостя по публичной ссылке ещё нет: без сессии лента закрыта."""
    anonymous = TestClient(app)

    assert anonymous.get(f"/api/projects/{project_id}/comments").status_code == 401
    assert (
        anonymous.post(f"/api/projects/{project_id}/comments", json={"body": "?"}).status_code
        == 401
    )


def test_a_viewer_may_comment_but_a_stranger_role_may_not(authed, project_id, db):
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
```

- [x] **Step 2: Убедиться, что тесты падают**

```bash
cd backend && uv run pytest tests/test_comment_api.py -q
```

Ожидается: 404 вместо 201 — маршрута нет.

- [x] **Step 3: Добавить маршруты**

В `backend/app/api/project_routes.py`. К импортам:

```python
from app.comments import (
    MAX_COMMENT_LEN,
    CommentRefused,
    TaskNotInProject,
    add_comment,
    list_comments,
)
from app.models import (
    Category,
    Comment,
    Dependency,
    ...
)
```

Рядом с `ProjectIn`/`ProjectOut`:

```python
class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_COMMENT_LEN)
    # null и отсутствие ключа — одно и то же: реплика к проекту целиком.
    task_id: uuid.UUID | None = None


def _comment_out(comment: Comment, actors: dict) -> dict:
    return {
        "id": str(comment.id),
        "task_id": str(comment.task_id) if comment.task_id else None,
        "body": comment.body,
        "created_at": comment.created_at.isoformat(),
        # Автор объектом или null — как в ленте ревизий. Гость приходит
        # именем: подписывают их по-разному, и различить их обязан ответ.
        "author": (
            {"id": str(comment.author_user_id), "name": actors[comment.author_user_id]}
            if comment.author_user_id in actors
            else None
        ),
        "guest_name": comment.guest_name,
    }
```

В конец файла:

```python
@router.get("/{project_id}/comments")
def list_project_comments(
    project_id: uuid.UUID,
    task_id: uuid.UUID | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Обсуждение задачи или проекта целиком.

    Читать вправе каждый, кто вправе читать проект: комментарий — не заметка,
    ограниченной видимости у него нет.
    """
    project, membership = _load_project(db, user, project_id)
    _require_project_read(membership)

    comments = list_comments(db, project, task_id=task_id, limit=limit)
    actors = {
        row.id: row.name
        for row in db.scalars(
            select(User).where(
                User.id.in_({c.author_user_id for c in comments if c.author_user_id})
            )
        ).all()
    }
    return [_comment_out(comment, actors) for comment in comments]


@router.post("/{project_id}/comments", status_code=201)
def create_comment(
    project_id: uuid.UUID,
    payload: CommentIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Реплика от участника с аккаунтом.

    Право спрашивается у матрицы: `viewer` и `client` комментируют, не имея
    права менять план, и второго списка ролей здесь не заводится.
    """
    project, membership = _load_project(db, user, project_id)
    if not can(parse_role(membership.role), Action.COMMENT):
        raise HTTPException(status_code=403, detail="forbidden")

    try:
        comment = add_comment(
            db, project, body=payload.body, task_id=payload.task_id, author=user
        )
    except TaskNotInProject as error:
        raise HTTPException(status_code=404, detail=error.code)
    except CommentRefused as error:
        raise HTTPException(status_code=422, detail=error.code)

    return _comment_out(comment, {user.id: user.name})
```

- [x] **Step 4: Убедиться, что тесты проходят**

```bash
cd backend && uv run pytest tests/test_comment_api.py -q
```

Ожидается: 7 passed.

- [x] **Step 5: Прогнать весь бэкенд**

```bash
cd backend && uv run pytest -q
```

Ожидается: всё зелёное.

- [x] **Step 6: Коммит**

```bash
git add backend/app/api/project_routes.py backend/tests/test_comment_api.py
git commit -m "feat: маршруты комментариев"
```

---

### Task 4: Обсуждение на карточке задачи

**Files:**
- Create: `frontend/src/api/comments.ts`
- Create: `frontend/src/task/Comments.tsx`
- Create: `frontend/src/task/Comments.test.tsx`
- Modify: `frontend/src/task/TaskPanel.tsx`
- Modify: `frontend/src/task/panel.css`
- Modify: `frontend/src/api/errors.ts`
- Modify: `frontend/src/i18n/az.json`, `frontend/src/i18n/en.json`, `frontend/src/i18n/ru.json`
- Modify: `frontend/src/test/project.ts`

**Interfaces:**
- Consumes: маршруты из Task 3.
- Produces: `commentsQueryKey(projectId, taskId)`, `listTaskComments`, `postComment`, компонент `<Comments projectId taskId />`.

Ключ запроса лежит под ключом проекта (`["project", id, "comments", taskId]`) — по той же причине, что и журнал: одно `invalidateQueries` по префиксу обновляет поддерево целиком.

Оптимистичной вставки здесь нет, и это осознанно: у реплики нет отката, а показать её до подтверждения значит однажды показать реплику, которой не существует. Отправка блокирует поле и снимает блокировку ответом.

- [x] **Step 1: Написать падающие тесты**

Создать `frontend/src/task/Comments.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";

const THREAD = [
  {
    id: "k1",
    task_id: "t1",
    body: "Клиент просит другой знак",
    created_at: "2026-03-05T10:00:00+00:00",
    author: { id: "u2", name: "Мария" },
    guest_name: null,
  },
  {
    id: "k2",
    task_id: "t1",
    body: "А когда сдача?",
    created_at: "2026-03-06T10:00:00+00:00",
    author: null,
    guest_name: "Нигяр",
  },
];

async function openCard() {
  renderProject();
  await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
  return screen.findByRole("complementary");
}

describe("обсуждение задачи", () => {
  beforeEach(() => {
    projectFixtures();
  });

  it("показывает реплики с подписями авторов", async () => {
    server.use(http.get("/api/projects/p1/comments", () => HttpResponse.json(THREAD)));

    const panel = await openCard();

    expect(await within(panel).findByText("Клиент просит другой знак")).toBeInTheDocument();
    expect(within(panel).getByText("Мария")).toBeInTheDocument();
  });

  it("отличает гостя от участника с аккаунтом", async () => {
    server.use(http.get("/api/projects/p1/comments", () => HttpResponse.json(THREAD)));

    const panel = await openCard();
    const guest = await within(panel).findByText(/Нигяр/);

    // Пометка рядом с именем, а не вместо него: гостя зовут по имени, но
    // читатель обязан видеть, что аккаунта за ним нет.
    expect(guest.textContent).toMatch(/гость/i);
  });

  it("отправляет реплику и показывает её после ответа сервера", async () => {
    const sent: unknown[] = [];
    let thread = [...THREAD];
    server.use(
      http.get("/api/projects/p1/comments", () => HttpResponse.json(thread)),
      http.post("/api/projects/p1/comments", async ({ request }) => {
        const body = await request.json();
        sent.push(body);
        const created = {
          id: "k3",
          task_id: "t1",
          body: (body as { body: string }).body,
          created_at: "2026-03-07T10:00:00+00:00",
          author: { id: "u1", name: "Алексей" },
          guest_name: null,
        };
        thread = [...thread, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const panel = await openCard();
    await userEvent.type(
      within(panel).getByLabelText(/Комментарий/i),
      "Беру в работу",
    );
    await userEvent.click(within(panel).getByRole("button", { name: /Отправить/i }));

    expect(await within(panel).findByText("Беру в работу")).toBeInTheDocument();
    expect(sent).toEqual([{ body: "Беру в работу", task_id: "t1" }]);
  });

  it("очищает поле после отправки", async () => {
    server.use(
      http.get("/api/projects/p1/comments", () => HttpResponse.json([])),
      http.post("/api/projects/p1/comments", () =>
        HttpResponse.json(
          {
            id: "k3",
            task_id: "t1",
            body: "Готово",
            created_at: "2026-03-07T10:00:00+00:00",
            author: { id: "u1", name: "Алексей" },
            guest_name: null,
          },
          { status: 201 },
        ),
      ),
    );

    const panel = await openCard();
    const field = within(panel).getByLabelText(/Комментарий/i);
    await userEvent.type(field, "Готово");
    await userEvent.click(within(panel).getByRole("button", { name: /Отправить/i }));

    await waitFor(() => expect(field).toHaveValue(""));
  });

  it("объясняет отказ словами и не теряет набранный текст", async () => {
    server.use(
      http.get("/api/projects/p1/comments", () => HttpResponse.json([])),
      http.post("/api/projects/p1/comments", () =>
        HttpResponse.json({ detail: "comment_empty" }, { status: 422 }),
      ),
    );

    const panel = await openCard();
    const field = within(panel).getByLabelText(/Комментарий/i);
    await userEvent.type(field, "  ");
    await userEvent.click(within(panel).getByRole("button", { name: /Отправить/i }));

    expect(await within(panel).findByRole("alert")).toHaveTextContent(/пуст/i);
    // Текст остаётся в поле: отказ — повод исправить реплику, а не набрать
    // её заново.
    expect(field).toHaveValue("  ");
  });

  it("не рисует ветку, если сервер её не отдал", async () => {
    server.use(
      http.get("/api/projects/p1/comments", () =>
        HttpResponse.json({ detail: "project_not_found" }, { status: 404 }),
      ),
    );

    const panel = await openCard();

    await waitFor(() =>
      expect(within(panel).queryByLabelText(/Комментарий/i)).not.toBeInTheDocument(),
    );
  });
});
```

- [x] **Step 2: Убедиться, что тесты падают**

```bash
cd frontend && npx vitest run src/task/Comments.test.tsx --maxWorkers=1
```

Ожидается: не найден `../api/comments`.

- [x] **Step 3: Написать клиент**

Создать `frontend/src/api/comments.ts`:

```ts
import { request } from "./client";

/**
 * Ключ ветки лежит под ключом проекта: `["project", id, ...]`.
 *
 * Та же причина, что и у журнала ревизий: изменение проекта сбрасывает всё
 * поддерево одним `invalidateQueries` по префиксу, и списку ключей, который
 * однажды забудут пополнить, взяться неоткуда.
 */
export function commentsQueryKey(projectId: string, taskId: string) {
  return ["project", projectId, "comments", taskId] as const;
}

export type Comment = {
  id: string;
  task_id: string | null;
  /** Текст человека. Не переводится. */
  body: string;
  created_at: string;
  /** Участник с аккаунтом — или null, если реплику оставил гость. */
  author: { id: string; name: string } | null;
  /** Имя гостя. Заполнено ровно тогда, когда `author` пуст. */
  guest_name: string | null;
};

export function listTaskComments(projectId: string, taskId: string): Promise<Comment[]> {
  return request<Comment[]>(
    `/api/projects/${projectId}/comments?task_id=${encodeURIComponent(taskId)}`,
  );
}

export function postComment(projectId: string, taskId: string, body: string): Promise<Comment> {
  return request<Comment>(`/api/projects/${projectId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, task_id: taskId }),
  });
}
```

- [x] **Step 4: Написать компонент**

Создать `frontend/src/task/Comments.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { commentsQueryKey, listTaskComments, postComment } from "../api/comments";
import type { Comment } from "../api/comments";
import { errorKey } from "../api/errors";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Обсуждение задачи.
 *
 * От старых к новым — так их отдаёт сервер, и переворачивать нить в браузере
 * значило бы держать порядок разговора в двух местах.
 *
 * Оптимистичной вставки нет: у реплики нет отката, и показать её до
 * подтверждения значит однажды показать реплику, которой не существует.
 *
 * Отказ ленты ничего не ломает — блока просто нет, а карточка выше работает
 * как работала. Тот же довод, что и у истории задачи.
 */
export function Comments({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { t } = useLocale();
  const client = useQueryClient();
  const [draft, setDraft] = useState("");

  const thread = useQuery({
    queryKey: commentsQueryKey(projectId, taskId),
    queryFn: () => listTaskComments(projectId, taskId),
    retry: false,
  });

  const send = useMutation({
    mutationFn: (body: string) => postComment(projectId, taskId, body),
    onSuccess: () => {
      // Черновик стирается только после подтверждения: отказ — повод
      // исправить реплику, а не набрать её заново.
      setDraft("");
      client.invalidateQueries({ queryKey: commentsQueryKey(projectId, taskId) });
    },
  });

  if (thread.error) return null;

  return (
    <section className="panel__comments">
      <h3 className="panel__history-title">{t("comments.title")}</h3>

      {thread.data && thread.data.length === 0 && <p className="muted">{t("comments.empty")}</p>}

      <ol className="panel__events">
        {thread.data?.map((comment) => (
          <li key={comment.id} className="panel__comment">
            <p className="panel__comment-meta">
              <span className="panel__event-actor">{signature(comment, t)}</span>
              <span>{formatShortDate(t, comment.created_at.slice(0, 10))}</span>
            </p>
            {/* Текст человека: выводится как есть, без перевода. */}
            <p className="panel__comment-body">{comment.body}</p>
          </li>
        ))}
      </ol>

      <form
        className="panel__comment-form"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate(draft);
        }}
      >
        <label className="panel__field" htmlFor="panel-comment">
          <span className="panel__label">{t("comments.field")}</span>
          <textarea
            id="panel-comment"
            className="panel__input"
            rows={2}
            value={draft}
            disabled={send.isPending}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>

        {send.error !== null && (
          <p className="error" role="alert">
            {t(errorKey(send.error))}
          </p>
        )}

        <button type="submit" className="panel__send" disabled={send.isPending}>
          {t("comments.submit")}
        </button>
      </form>
    </section>
  );
}

/**
 * Подпись под репликой.
 *
 * Имя — содержимое пользователя и не переводится; пометка «гость» —
 * интерфейс и переводится. Поэтому они собираются шаблоном с подстановкой, а
 * не склейкой строк: в другом языке пометка встанет по другую сторону имени.
 */
function signature(comment: Comment, t: (key: string, params?: Record<string, string>) => string) {
  if (comment.author) return comment.author.name;
  return t("comments.guest", { name: comment.guest_name ?? "" });
}
```

- [x] **Step 5: Подключить к карточке и словарям**

В `frontend/src/task/TaskPanel.tsx` — импорт `import { Comments } from "./Comments";` и строка после `<History ... />`:

```tsx
      <Comments projectId={projectId} taskId={task.id} />
```

В `frontend/src/api/errors.ts` дописать в `PLAIN_CODES`:

```ts
  "comment_empty",
  "comment_author_required",
```

В `frontend/src/i18n/ru.json` — новый блок верхнего уровня рядом с `history`:

```json
  "comments": {
    "title": "Обсуждение",
    "empty": "Пока ничего не обсуждали",
    "field": "Комментарий",
    "submit": "Отправить",
    "guest": "{name} (гость)"
  },
```

и в `error`:

```json
    "comment_empty": "Пустой комментарий отправить нельзя",
    "comment_author_required": "Комментарий некому подписать",
```

В `frontend/src/i18n/en.json`:

```json
  "comments": {
    "title": "Discussion",
    "empty": "Nothing discussed yet",
    "field": "Comment",
    "submit": "Send",
    "guest": "{name} (guest)"
  },
```

```json
    "comment_empty": "An empty comment cannot be sent",
    "comment_author_required": "There is no one to sign this comment",
```

В `frontend/src/i18n/az.json`:

```json
  "comments": {
    "title": "Müzakirə",
    "empty": "Hələ müzakirə olunmayıb",
    "field": "Şərh",
    "submit": "Göndər",
    "guest": "{name} (qonaq)"
  },
```

```json
    "comment_empty": "Boş şərh göndərmək olmaz",
    "comment_author_required": "Şərhi imzalayacaq kimsə yoxdur",
```

В `frontend/src/test/project.ts`, в `projectFixtures()`, рядом с заглушкой ревизий:

```ts
    // Ветка обсуждения. Пустая по умолчанию — по тому же доводу, что и
    // журнал: тест, которому она важна, объявляет её сам.
    http.get("/api/projects/p1/comments", () => HttpResponse.json([])),
```

- [x] **Step 6: Оформление**

В конец `frontend/src/task/panel.css`:

```css
.panel__comments {
  margin-top: 20px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.panel__comment {
  margin-bottom: 12px;
  font-size: 13px;
}

/* Подпись мельче и тише самой реплики: читают текст, а не шапку над ним. */
.panel__comment-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

/* pre-wrap: человек разбивает реплику на абзацы, и склеивать их в сплошную
   строку значит переписывать за ним. */
.panel__comment-body {
  margin: 2px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.panel__comment-form {
  margin-top: 12px;
}

.panel__send {
  margin-top: 8px;
}
```

- [x] **Step 7: Убедиться, что тесты проходят**

```bash
cd frontend && npx vitest run src/task/Comments.test.tsx src/i18n/i18n.test.ts --maxWorkers=1
```

Ожидается: PASS, в том числе тест полноты словарей.

- [x] **Step 8: Прогнать весь фронтенд и линтер**

```bash
cd frontend && npx vitest run --maxWorkers=2 && npm run lint && npx tsc -b
```

Ожидается: всё зелёное. (`--maxWorkers=2`: на перегруженной машине параллельные воркеры дают ложные падения по таймауту.)

- [x] **Step 9: Коммит**

```bash
git add frontend/src
git commit -m "feat: обсуждение на карточке задачи"
```

---

## Что осталось за границей плана

- **Гость по публичной ссылке.** `ShareLink` в схеме нет, опознать гостя нечем. `add_comment` его уже принимает (`guest_name`), маршрут — нет. Это план публичных ссылок.
- **`GUEST_COMMENT_RATE_LIMIT`.** Ограничивать нечего, пока нет гостевого пути: ограничитель без вызывающего — код, который никто не проверяет.
- **Удаление и правка реплик.** Спецификация их не обещает.
- **Живые обновления.** Ветка обновляется ответом на отправку; рассылка по WebSocket — отдельный план.
- **Обсуждение проекта целиком.** Маршрут его отдаёт (`task_id` не указан), места на экране у него пока нет.
