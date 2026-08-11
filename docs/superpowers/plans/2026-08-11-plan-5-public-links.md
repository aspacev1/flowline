# План 5: публичные ссылки и гости — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показать проект человеку без аккаунта по адресу, собранному из слагов организации и проекта, и дать ему комментировать под своим именем.

**Architecture:** Публичная страница читает проект отдельным маршрутом без сессии. Тело ответа собирает тот же сборщик, что и рабочий экран, — с выключенными заметками и исполнителями: две копии одной раскладки разошлись бы на первой же новой колонке, и внутренняя заметка утекла бы наружу именно через ту копию, про которую забыли. Право гостя комментировать спрашивается у той же матрицы, что и у участника: `can(None, Action.COMMENT, project_granted=True)`, где ролью выступает `None`, а выданным доступом — сама действующая ссылка.

**Tech Stack:** Как в планах 0–4. Никаких новых зависимостей.

## Решения, принятые до плана

**Адрес — `/p/{слаг-организации}/{слаг-проекта}`, без токена.** Так решил владелец продукта. Спецификация в §7 обещает и красивый адрес из слагов, и перевыпуск ссылки, убивающий прежнюю, — вместе это не работает: если в адресе нет секрета, после перевыпуска адрес тот же самый. Принятые следствия:

- Отзыв снимает публикацию: адрес мгновенно перестаёт открываться. Повторная публикация оживляет **тот же** адрес — «перевыпуска», после которого старая ссылка мертва, а новая работает, у слагов быть не может.
- Настоящий перевыпуск — переименование слага проекта. Поэтому правка слага входит в этот план, а не в план настроек: без неё обещание §7 не выполняется вообще ничем.
- Опубликованный проект угадывается перебором слагов. Это цена решения, и она осознанная: наружу не выходят ни внутренние заметки, ни состав организации, ни журнал изменений.

**Префикс `/p/` сохранён,** хотя в примере владельца его не было (`flowline.com/company/project`). Причина техническая: `/{что-то}/{что-то}` в корне перехватывает и собственные адреса приложения — организация со слагом `login` или `projects` заслонила бы вход и список проектов, — и ни один неизвестный двухсегментный адрес после этого не сможет честно ответить «не найдено».

**Токена в `share_links` нет.** Спецификация перечисляет его в составе сущности, но в адресе его теперь нет, а секрет, который никуда не подставляется, ничего не защищает и вводит в заблуждение следующего читателя.

## Global Constraints

- Публичные маршруты не требуют сессии и не читают куку. Всё, что решает доступ, — слаги в адресе и состояние ссылки.
- Внутренняя заметка не выходит наружу никогда. Решение принимает сервер: нет поля в ответе — нет блока в интерфейсе.
- Право гостя спрашивается у `app.access`, а не сравнивается со строкой. Ролью гостя выступает `None`.
- Отказы сервера — машинный код в `detail`, без прозы.
- Языки: `az` по умолчанию, `en`, `ru`; ключ обязан появиться во всех трёх словарях.
- Даты и окончания считает сервер. Публичная страница считает не больше рабочей — то есть ничего.
- Ограничитель гостевых реплик берёт потолок из `GUEST_COMMENT_RATE_LIMIT`, а не из константы в коде.

## Файлы

| Файл | Ответственность |
|---|---|
| `backend/app/models.py` | Таблица `share_links` |
| `backend/app/sharing.py` | Домен публикации: опубликовать, отозвать, переключить комментарии, найти по слагам |
| `backend/app/project_state.py` | Единственный сборщик состояния проекта — для рабочего экрана и для публичной страницы |
| `backend/app/rate_limit.py` | Скользящее окно по ключу; ключ гостя — его адрес |
| `backend/app/api/project_routes.py` | Настройки проекта, публикация, слаг |
| `backend/app/api/public_routes.py` | Чтение проекта и гостевые реплики без сессии |
| `frontend/src/api/sharing.ts`, `frontend/src/screens/ProjectSettings.tsx` | Экран настроек проекта |
| `frontend/src/api/public.ts`, `frontend/src/screens/PublicProject.tsx` | Публичная страница |

---

### Task 1: Таблица публичной ссылки

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/migrations/versions/<hash>_share_links.py`
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces: `ShareLink` с полями `id`, `project_id` (уникален), `comments_enabled`, `revoked_at`, `created_at`.

Ссылка одна на проект — отсюда `UniqueConstraint("project_id")`. Второй ряд означал бы два разных адреса к одному проекту, а адрес выводится из слагов и потому ровно один.

- [ ] **Step 1: Написать падающий тест**

В конец `backend/tests/test_models.py`:

```python
def test_project_has_at_most_one_share_link(db):
    """Адрес выводится из слагов и потому ровно один. Второй ряд означал бы
    два разных адреса к одному проекту — и вопрос, какой из них главный."""
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    project = Project(org_id=org.id, name="Redesign", slug="redesign")
    db.add(project)
    db.flush()

    link = ShareLink(project_id=project.id)
    db.add(link)
    db.flush()

    assert link.comments_enabled is True
    assert link.revoked_at is None

    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.add(ShareLink(project_id=project.id))
            db.flush()
```

Импорт в шапке дополнить `ShareLink`.

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd backend && uv run pytest tests/test_models.py -q
```

Ожидается: `ImportError: cannot import name 'ShareLink'`.

- [ ] **Step 3: Добавить модель**

В `backend/app/models.py`, после `Comment`:

```python
class ShareLink(Base):
    __tablename__ = "share_links"
    # Одна ссылка на проект: адрес выводится из слагов организации и проекта,
    # и второго адреса к тому же проекту просто не существует.
    __table_args__ = (UniqueConstraint("project_id"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    # Токена здесь нет, хотя спецификация его перечисляет: адрес собран из
    # слагов, подставлять секрет некуда. Колонка, которую никто не читает,
    # обещала бы защиту, которой нет.
    comments_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Отзыв не удаляет ряд: когда ссылку открывали и когда закрыли — это
    # журнал, а не мусор. Публикация заново обнуляет отметку.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 4: Убедиться, что тест проходит**

```bash
cd backend && uv run pytest tests/test_models.py -q
```

- [ ] **Step 5: Миграция**

```bash
cd backend && uv run alembic revision --autogenerate -m "share_links" && uv run alembic upgrade head && uv run pytest -q
```

Проверить, что в `upgrade()` только `create_table('share_links')`.

- [ ] **Step 6: Коммит**

```bash
git add backend/app/models.py backend/migrations backend/tests/test_models.py
git commit -m "feat: таблица публичной ссылки"
```

---

### Task 2: Домен публикации

**Files:**
- Create: `backend/app/sharing.py`
- Test: `backend/tests/test_sharing.py`

**Interfaces:**
- Produces:
  - `publish(db, project, org) -> ShareLink`
  - `revoke(db, project) -> None`
  - `set_comments_enabled(db, project, enabled: bool) -> ShareLink`
  - `link_of(db, project) -> ShareLink | None` — действующая ссылка или `None`
  - `resolve(db, org_slug: str, project_slug: str) -> tuple[Project, Organization, ShareLink]`
  - `public_path(org, project) -> str`
  - `SharingRefused(code, message)`, `NotPublished(SharingRefused)`

`resolve` — единственное место, где решается, открыт ли проект наружу. Условий три (ссылка есть, не отозвана, организация не запретила публикацию вовсе), и разнести их по маршрутам значило бы проверить два из трёх в одном месте и три из трёх в другом.

- [ ] **Step 1: Написать падающие тесты**

Создать `backend/tests/test_sharing.py`:

```python
import pytest

from app.models import Organization, Project, ShareLink
from app.sharing import (
    NotPublished,
    SharingRefused,
    link_of,
    public_path,
    publish,
    resolve,
    revoke,
    set_comments_enabled,
)


@pytest.fixture
def org(db):
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    return org


@pytest.fixture
def project(db, org):
    project = Project(org_id=org.id, name="Redesign", slug="redesign-2026")
    db.add(project)
    db.flush()
    return project


def test_publishing_opens_the_address_built_from_slugs(db, org, project):
    link = publish(db, project, org)

    assert link.revoked_at is None
    assert public_path(org, project) == "/p/acme/redesign-2026"
    assert resolve(db, "acme", "redesign-2026")[0].id == project.id


def test_comments_start_from_the_organization_default(db, org, project):
    """Умолчание организации — это умолчание, а не рекомендация: проект,
    который его не переопределял, обязан ему следовать."""
    org.default_comments_enabled = False
    db.flush()

    assert publish(db, project, org).comments_enabled is False


def test_revoking_closes_the_address_immediately(db, org, project):
    publish(db, project, org)
    revoke(db, project)

    with pytest.raises(NotPublished):
        resolve(db, "acme", "redesign-2026")
    assert link_of(db, project) is None


def test_publishing_again_revives_the_same_address(db, org, project):
    """Следствие решения об адресе из слагов, а не оплошность: секрета в
    адресе нет, и «новой» ссылке взяться неоткуда."""
    publish(db, project, org)
    revoke(db, project)
    revived = publish(db, project, org)

    assert revived.revoked_at is None
    assert resolve(db, "acme", "redesign-2026")[0].id == project.id
    # Ряд тот же самый: журнал публикаций не должен плодить дубликаты.
    assert db.query(ShareLink).count() == 1


def test_organization_may_forbid_public_sharing_entirely(db, org, project):
    org.public_sharing_enabled = False
    db.flush()

    with pytest.raises(SharingRefused) as refusal:
        publish(db, project, org)
    assert refusal.value.code == "public_sharing_disabled"


def test_a_link_of_an_organization_that_revoked_sharing_stops_resolving(db, org, project):
    """Выключатель организации гасит уже выданные ссылки, а не только новые:
    иначе запрет ничего не запрещает до тех пор, пока кто-то не отзовёт
    каждую ссылку руками."""
    publish(db, project, org)
    org.public_sharing_enabled = False
    db.flush()

    with pytest.raises(NotPublished):
        resolve(db, "acme", "redesign-2026")


def test_unknown_slugs_are_refused_the_same_way_as_a_revoked_link(db, org, project):
    """Одинаковый отказ — не лень: разные ответы рассказали бы перебором,
    какие организации и проекты существуют."""
    publish(db, project, org)

    with pytest.raises(NotPublished):
        resolve(db, "acme", "no-such-project")
    with pytest.raises(NotPublished):
        resolve(db, "globex", "redesign-2026")


def test_comments_switch_is_remembered(db, org, project):
    publish(db, project, org)

    assert set_comments_enabled(db, project, False).comments_enabled is False
    assert resolve(db, "acme", "redesign-2026")[2].comments_enabled is False


def test_switching_comments_on_an_unpublished_project_is_refused(db, org, project):
    with pytest.raises(SharingRefused) as refusal:
        set_comments_enabled(db, project, True)
    assert refusal.value.code == "not_published"
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
cd backend && uv run pytest tests/test_sharing.py -q
```

Ожидается: `ModuleNotFoundError: No module named 'app.sharing'`.

- [ ] **Step 3: Написать модуль**

Создать `backend/app/sharing.py`:

```python
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.models import Organization, Project, ShareLink


class SharingRefused(Exception):
    """Отказ опубликовать или изменить публикацию.

    Той же формы, что MutationError и CommentRefused: машинный код наружу,
    человеческий текст — в журнал.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class NotPublished(SharingRefused):
    """По этому адресу ничего не открыто.

    Один класс на три разных случая — нет такой организации, нет такого
    проекта, ссылка отозвана — сознательно: разные ответы позволили бы
    перебором выяснить, какие организации и проекты существуют.
    """


def public_path(org: Organization, project: Project) -> str:
    """Адрес публичной страницы.

    Собирается здесь, а не в браузере: слаги нормализует сервер (см. text.py),
    и второй сборщик адреса в клиенте однажды разойдётся с этим — получится
    ссылка, которая не открывается.

    Префикс `/p/` не украшение: без него `/{организация}/{проект}` перехватил
    бы и собственные адреса приложения, и организация со слагом `login`
    заслонила бы вход.
    """
    return f"/p/{org.slug}/{project.slug}"


def link_of(db: DbSession, project: Project) -> ShareLink | None:
    """Действующая ссылка проекта. Отозванная — это отсутствие ссылки."""
    link = db.scalar(select(ShareLink).where(ShareLink.project_id == project.id))
    return link if link is not None and link.revoked_at is None else link and None


def publish(db: DbSession, project: Project, org: Organization) -> ShareLink:
    """Открыть проект наружу.

    Повторная публикация оживляет прежний ряд, а не создаёт новый: ряд — это
    журнал публикаций проекта, и второй ряд означал бы второй адрес, которого
    у слагов быть не может.
    """
    if not org.public_sharing_enabled:
        raise SharingRefused("public_sharing_disabled", "организация запретила публичные ссылки")

    link = db.scalar(select(ShareLink).where(ShareLink.project_id == project.id))
    if link is None:
        # Умолчание организации применяется один раз, при первой публикации:
        # дальше переключателем распоряжается владелец проекта, и повторная
        # публикация не должна отменять его решение.
        link = ShareLink(project_id=project.id, comments_enabled=org.default_comments_enabled)
        db.add(link)
    else:
        link.revoked_at = None
    db.flush()
    return link


def revoke(db: DbSession, project: Project) -> None:
    """Закрыть адрес. Мгновенно: следующий запрос по нему уже не откроется."""
    link = db.scalar(select(ShareLink).where(ShareLink.project_id == project.id))
    if link is not None and link.revoked_at is None:
        link.revoked_at = datetime.now(timezone.utc)
        db.flush()


def set_comments_enabled(db: DbSession, project: Project, enabled: bool) -> ShareLink:
    link = link_of(db, project)
    if link is None:
        raise SharingRefused("not_published", "проект не опубликован")
    link.comments_enabled = enabled
    db.flush()
    return link


def resolve(
    db: DbSession, org_slug: str, project_slug: str
) -> tuple[Project, Organization, ShareLink]:
    """Проект, открытый по этому адресу, — или отказ.

    Единственное место, где решается, открыт ли проект наружу. Условий три —
    организация не запретила публикацию, ссылка есть, ссылка не отозвана, — и
    разнести их по маршрутам значило бы однажды проверить два из трёх.
    """
    row = db.execute(
        select(Project, Organization, ShareLink)
        .join(Organization, Organization.id == Project.org_id)
        .join(ShareLink, ShareLink.project_id == Project.id)
        .where(
            Organization.slug == org_slug,
            Project.slug == project_slug,
            ShareLink.revoked_at.is_(None),
            Organization.public_sharing_enabled.is_(True),
        )
    ).first()
    if row is None:
        raise NotPublished("project_not_found", "по этому адресу ничего не открыто")
    return row[0], row[1], row[2]
```

- [ ] **Step 4: Убедиться, что тесты проходят**

```bash
cd backend && uv run pytest tests/test_sharing.py -q
```

Ожидается: 9 passed.

- [ ] **Step 5: Коммит**

```bash
git add backend/app/sharing.py backend/tests/test_sharing.py
git commit -m "feat: домен публикации проекта"
```

---

### Task 3: Один сборщик состояния проекта

**Files:**
- Create: `backend/app/project_state.py`
- Modify: `backend/app/api/project_routes.py`
- Test: `backend/tests/test_project_state.py`

**Interfaces:**
- Produces: `build_state(db, project, org, *, show_notes: bool, show_assignees: bool) -> dict`.

Правка без изменения поведения: тело `GET /api/projects/{id}` переезжает в модуль как есть, маршрут начинает его звать. Делается **до** публичного маршрута и отдельным коммитом, потому что иначе публичная страница получит вторую копию раскладки, и первая же новая колонка появится только в одной из них — а если этой колонкой окажется заметка, она утечёт наружу.

`show_assignees` выключается для гостя: исполнители — это состав организации, а его гостю не показывают (`GET /api/org/members` роль `client` не получает вовсе).

- [ ] **Step 1: Написать тест на сборщик**

Создать `backend/tests/test_project_state.py`:

```python
from datetime import date

import pytest

from app.models import Category, Organization, Project, Task, User
from app.project_state import build_state
from app.security import hash_password


@pytest.fixture
def filled(db):
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    project = Project(org_id=org.id, name="Redesign", slug="redesign")
    db.add(project)
    db.flush()
    category = Category(project_id=project.id, name="Дизайн", color="#3b82f6", position=0)
    db.add(category)
    db.flush()
    task = Task(
        project_id=project.id,
        category_id=category.id,
        name="Логотип",
        internal_note="клиент платит с задержкой",
        start_date=date(2026, 3, 4),
        duration_days=5,
    )
    db.add(task)
    db.flush()
    return project, org


def test_state_carries_the_note_when_the_reader_may_see_it(db, filled):
    project, org = filled
    state = build_state(db, project, org, show_notes=True, show_assignees=True)

    assert state["tasks"][0]["internal_note"] == "клиент платит с задержкой"
    assert "assignee_ids" in state["tasks"][0]
    assert state["tasks"][0]["end_date"] == "2026-03-10"


def test_state_for_a_guest_carries_neither_notes_nor_assignees(db, filled):
    """Заметка не выходит наружу никогда, а исполнители — это состав
    организации, которого гость не видит и в остальных маршрутах."""
    project, org = filled
    state = build_state(db, project, org, show_notes=False, show_assignees=False)

    assert "internal_note" not in state["tasks"][0]
    assert "assignee_ids" not in state["tasks"][0]
    # Всё остальное на месте: гость видит ту же раскладку, а не огрызок.
    assert state["tasks"][0]["name"] == "Логотип"
    assert state["calendar"]["working_days"] > 0
```

- [ ] **Step 2: Убедиться, что тест падает**

```bash
cd backend && uv run pytest tests/test_project_state.py -q
```

Ожидается: `ModuleNotFoundError: No module named 'app.project_state'`.

- [ ] **Step 3: Перенести сборку состояния в модуль**

Создать `backend/app/project_state.py`: перенести в него **без изменений по существу** тело `get_project` из `backend/app/api/project_routes.py` начиная со строки `calendar = project_calendar(project, org)` и до `return {...}` включительно, обернув в функцию:

```python
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.calendar import CalendarError, end_date
from app.models import Category, Dependency, Organization, Project, Task, TaskAssignee
from app.settings_resolution import project_calendar, resolve_shift_threshold, resolve_timezone


def build_state(
    db: DbSession,
    project: Project,
    org: Organization,
    *,
    show_notes: bool,
    show_assignees: bool,
) -> dict:
    """Состояние проекта в том виде, в каком его показывают на экране.

    Один сборщик на рабочий экран и на публичную страницу. Вторая копия
    разошлась бы с первой на первой же новой колонке — а если этой колонкой
    окажется внутренняя заметка, она утечёт наружу именно через ту копию, про
    которую забыли.

    Что показывать, решает вызывающий: заметку — по праву READ_INTERNAL_NOTE,
    исполнителей — по тому, видит ли читатель состав организации вообще.
    """
```

Тело — прежний код с двумя различиями: словарь исполнителей собирается только при `show_assignees`, и в задачу он подставляется тем же приёмом, что и заметка:

```python
    assignees: dict[str, list[str]] = {}
    if show_assignees:
        assignees = {str(t.id): [] for t in tasks}
        for task_id, user_id in db.execute(...).all():
            assignees[str(task_id)].append(str(user_id))
```

и в сборке задачи:

```python
                **({"assignee_ids": assignees[str(t.id)]} if show_assignees else {}),
                **({"internal_note": t.internal_note} if show_notes else {}),
```

- [ ] **Step 4: Позвать сборщик из маршрута**

`get_project` в `backend/app/api/project_routes.py` сокращается до:

```python
@router.get("/{project_id}")
def get_project(
    project_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    project, membership = _load_project(db, user, project_id)
    _require_project_read(membership)
    org = db.get(Organization, project.org_id)
    return build_state(
        db,
        project,
        org,
        show_notes=can(parse_role(membership.role), Action.READ_INTERNAL_NOTE),
        show_assignees=True,
    )
```

Неиспользованные после переезда импорты (`Category`, `Task`, `TaskAssignee`, `Dependency`, `end_date`, `CalendarError`, `project_calendar`, `resolve_*`) из `project_routes.py` убрать — те, что ещё нужны мутациям, оставить; проверяет `npm run lint`-эквивалент для Python здесь только глазами, поэтому свериться со списком в конце файла.

- [ ] **Step 5: Убедиться, что ничего не сломалось**

```bash
cd backend && uv run pytest -q
```

Ожидается: все прежние тесты проекта проходят без правок — это и есть проверка того, что правка не изменила поведение.

- [ ] **Step 6: Коммит**

```bash
git add backend/app/project_state.py backend/app/api/project_routes.py backend/tests/test_project_state.py
git commit -m "refactor: состояние проекта собирается одним местом"
```

---

### Task 4: Настройки проекта и публикация

**Files:**
- Modify: `backend/app/api/project_routes.py`
- Test: `backend/tests/test_share_api.py`

**Interfaces:**
- Produces:
  - `GET /api/projects/{id}/settings` → `{slug, public_url, public_sharing_enabled, share: {published, comments_enabled}}`
  - `PUT /api/projects/{id}/share` тело `{published: bool, comments_enabled: bool}` → тот же объект `share`

Один маршрут вместо трёх (опубликовать, отозвать, переключить): тело описывает желаемое состояние целиком, поэтому повторный вызов ничего не ломает, а переключатель и кнопка публикации в интерфейсе шлют одно и то же.

Право — `Action.PROJECT_ADMIN`: публикация проекта наружу это не то же, что правка задачи, и `viewer`, которому правка запрещена, тем более не должен открывать проект миру.

- [ ] **Step 1: Написать падающие тесты**

Создать `backend/tests/test_share_api.py` с фикстурами `client`/`authed`/`project_id` (скопировать из `tests/test_comment_api.py` — они там же и той же формы) и тестами:

```python
def test_settings_show_the_address_before_it_is_published(authed, project_id):
    """Адрес известен заранее: он выведен из слагов, а не выдан публикацией.
    Владелец должен видеть, что именно он собирается открыть."""
    settings = authed.get(f"/api/projects/{project_id}/settings").json()

    assert settings["public_url"].endswith("/p/alex/redesign")
    assert settings["share"]["published"] is False


def test_publishing_and_revoking_flip_the_same_field(authed, project_id):
    published = authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": True, "comments_enabled": True},
    )
    assert published.status_code == 200
    assert published.json()["published"] is True

    revoked = authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": False, "comments_enabled": True},
    )
    assert revoked.json()["published"] is False
    assert authed.get(f"/api/projects/{project_id}/settings").json()["share"]["published"] is False


def test_comments_switch_survives_republishing(authed, project_id):
    """Переключателем распоряжается владелец проекта: повторная публикация не
    должна возвращать умолчание организации поверх его решения."""
    authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": True, "comments_enabled": False},
    )
    authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": False, "comments_enabled": False},
    )
    again = authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": True, "comments_enabled": False},
    )

    assert again.json()["comments_enabled"] is False


def test_a_viewer_may_not_publish_a_project(authed, project_id, db):
    """Открыть проект миру — не то же, что поправить задачу: право отдельное."""
    from sqlalchemy import select

    from app.models import Membership

    db.scalar(select(Membership)).role = "viewer"
    db.flush()

    response = authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": True, "comments_enabled": True},
    )
    assert response.status_code == 403


def test_organization_that_forbids_sharing_refuses_publication(authed, project_id, db):
    from sqlalchemy import select

    from app.models import Organization

    db.scalar(select(Organization)).public_sharing_enabled = False
    db.flush()

    response = authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": True, "comments_enabled": True},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "public_sharing_disabled"


def test_settings_of_another_organization_are_not_reachable(authed, db):
    from app.models import Organization, Project

    other = Organization(name="Globex", slug="globex")
    db.add(other)
    db.flush()
    stranger = Project(org_id=other.id, name="Secret", slug="secret")
    db.add(stranger)
    db.flush()

    assert authed.get(f"/api/projects/{stranger.id}/settings").status_code == 404
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
cd backend && uv run pytest tests/test_share_api.py -q
```

- [ ] **Step 3: Добавить маршруты**

В `backend/app/api/project_routes.py`:

```python
class ShareIn(BaseModel):
    published: bool
    comments_enabled: bool


def _share_out(link: ShareLink | None) -> dict:
    return {
        "published": link is not None,
        # Выключенная публикация не забывает настройку комментариев: она
        # хранится в ряду и вернётся вместе со следующей публикацией.
        "comments_enabled": link.comments_enabled if link else True,
    }


@router.get("/{project_id}/settings")
def project_settings(
    project_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    project, membership = _load_project(db, user, project_id)
    if not can(parse_role(membership.role), Action.PROJECT_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")
    org = db.get(Organization, project.org_id)

    return {
        "slug": project.slug,
        # Полный адрес собирает сервер: PUBLIC_BASE_URL знает он, а браузер
        # знает только тот адрес, по которому открыт сам, — за обратным
        # прокси это разные вещи.
        "public_url": get_settings().public_base_url.rstrip("/") + public_path(org, project),
        "public_sharing_enabled": org.public_sharing_enabled,
        "share": _share_out(link_of(db, project)),
    }


@router.put("/{project_id}/share")
def set_share(
    project_id: uuid.UUID,
    payload: ShareIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Желаемое состояние публикации целиком, а не три отдельных действия.

    Повторный вызов с тем же телом ничего не меняет, поэтому кнопка публикации
    и переключатель комментариев шлют одно и то же, а гонка двух вкладок
    заканчивается последним состоянием, а не ошибкой.
    """
    project, membership = _load_project(db, user, project_id)
    if not can(parse_role(membership.role), Action.PROJECT_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")
    org = db.get(Organization, project.org_id)

    try:
        if payload.published:
            publish(db, project, org)
            set_comments_enabled(db, project, payload.comments_enabled)
        else:
            revoke(db, project)
    except SharingRefused as error:
        raise HTTPException(status_code=422, detail=error.code)

    return _share_out(link_of(db, project))
```

Импорты: `from app.config import get_settings`, `from app.models import ShareLink`, `from app.sharing import SharingRefused, link_of, public_path, publish, revoke, set_comments_enabled`.

- [ ] **Step 4: Убедиться, что тесты проходят, и прогнать бэкенд**

```bash
cd backend && uv run pytest -q
```

- [ ] **Step 5: Коммит**

```bash
git add backend/app/api/project_routes.py backend/tests/test_share_api.py
git commit -m "feat: настройки проекта и публикация"
```

---

### Task 5: Слаг проекта — проверка и переименование

**Files:**
- Modify: `backend/app/projects.py`, `backend/app/api/project_routes.py`
- Test: `backend/tests/test_slug_api.py`

**Interfaces:**
- Produces:
  - `rename_slug(db, project, raw: str) -> Project` и `free_slug(db, org_id, raw: str) -> tuple[bool, str]` в `app/projects.py`
  - `GET /api/projects/{id}/slug-check?slug=…` → `{available: bool, suggestion: str}`
  - `PUT /api/projects/{id}/slug` тело `{slug}` → `{slug, public_url}`; занятый — 422 `slug_taken`

Переименование — единственный способ по-настоящему перевыпустить ссылку при адресе из слагов: старый адрес после него мёртв, новый работает. Поэтому оно здесь, а не в плане настроек.

Слаг нормализует сервер той же `slugify`, что и при создании: человек вводит «Редизайн 2026», получает `redizayn-2026`. Повторять транслитерацию в браузере нельзя — расхождение даст ссылку, которая не открывается.

- [ ] **Step 1: Написать падающие тесты**

Создать `backend/tests/test_slug_api.py` (фикстуры — как в `test_share_api.py`):

```python
def test_slug_is_normalized_by_the_server_not_by_the_caller(authed, project_id):
    response = authed.put(f"/api/projects/{project_id}/slug", json={"slug": "Редизайн 2026"})

    assert response.status_code == 200
    assert response.json()["slug"] == "redizayn-2026"


def test_renaming_the_slug_kills_the_old_address(authed, project_id):
    """При адресе из слагов это единственный настоящий перевыпуск ссылки."""
    authed.put(
        f"/api/projects/{project_id}/share", json={"published": True, "comments_enabled": True}
    )
    before = authed.get(f"/api/projects/{project_id}/settings").json()["public_url"]

    authed.put(f"/api/projects/{project_id}/slug", json={"slug": "redesign-2027"})
    after = authed.get(f"/api/projects/{project_id}/settings").json()["public_url"]

    assert before != after
    assert after.endswith("/p/alex/redesign-2027")


def test_a_taken_slug_is_refused_and_a_free_one_is_suggested(authed, project_id):
    authed.post("/api/projects", json={"name": "Другой"})
    taken = authed.get("/api/projects").json()[1]["slug"]

    refusal = authed.put(f"/api/projects/{project_id}/slug", json={"slug": taken})
    assert refusal.status_code == 422
    assert refusal.json()["detail"] == "slug_taken"

    check = authed.get(f"/api/projects/{project_id}/slug-check?slug={taken}").json()
    assert check["available"] is False
    assert check["suggestion"].startswith(taken)
    assert check["suggestion"] != taken


def test_its_own_slug_is_not_taken_by_itself(authed, project_id):
    """Иначе форма настроек ругается на слаг, который уже стоит в поле."""
    current = authed.get(f"/api/projects/{project_id}/settings").json()["slug"]

    assert authed.get(f"/api/projects/{project_id}/slug-check?slug={current}").json()[
        "available"
    ] is True


def test_a_slug_that_normalizes_to_nothing_is_refused(authed, project_id):
    """«...» и одни пробелы дают пустой слаг, а пустой адрес не открывается."""
    response = authed.put(f"/api/projects/{project_id}/slug", json={"slug": "..."})

    assert response.status_code == 422
    assert response.json()["detail"] == "slug_empty"


def test_a_viewer_may_not_rename_the_slug(authed, project_id, db):
    from sqlalchemy import select

    from app.models import Membership

    db.scalar(select(Membership)).role = "viewer"
    db.flush()

    assert (
        authed.put(f"/api/projects/{project_id}/slug", json={"slug": "whatever"}).status_code == 403
    )
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
cd backend && uv run pytest tests/test_slug_api.py -q
```

- [ ] **Step 3: Дописать домен**

В `backend/app/projects.py`:

```python
import secrets

from app.text import slugify


class SlugRefused(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def free_slug(db: DbSession, org_id: uuid.UUID, raw: str, *, except_id=None) -> tuple[bool, str]:
    """Свободен ли слаг и что предложить, если занят.

    Свой собственный слаг проекта занятым не считается: иначе форма настроек
    ругалась бы на значение, которое в ней уже стоит.
    """
    slug = slugify(raw, fallback="")
    if not slug:
        raise SlugRefused("slug_empty", "слаг пуст после нормализации")

    taken = db.scalar(
        select(Project.id).where(
            Project.org_id == org_id, Project.slug == slug, Project.id != except_id
        )
    )
    if taken is None:
        return True, slug
    # Тот же приём, что и при создании: суффикс, а не отказ без вариантов.
    return False, f"{slug}-{secrets.token_hex(3)}"


def rename_slug(db: DbSession, project: Project, raw: str) -> Project:
    available, slug = free_slug(db, project.org_id, raw, except_id=project.id)
    if not available:
        raise SlugRefused("slug_taken", "слаг занят")
    project.slug = slug
    db.flush()
    return project
```

- [ ] **Step 4: Добавить маршруты**

В `backend/app/api/project_routes.py`:

```python
class SlugIn(BaseModel):
    slug: str = Field(min_length=1, max_length=100)


@router.get("/{project_id}/slug-check")
def check_slug(
    project_id: uuid.UUID,
    slug: str = Query(min_length=1, max_length=100),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    project, membership = _load_project(db, user, project_id)
    if not can(parse_role(membership.role), Action.PROJECT_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")
    try:
        available, suggestion = free_slug(db, project.org_id, slug, except_id=project.id)
    except SlugRefused as error:
        raise HTTPException(status_code=422, detail=error.code)
    return {"available": available, "suggestion": suggestion}


@router.put("/{project_id}/slug")
def set_slug(
    project_id: uuid.UUID,
    payload: SlugIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    project, membership = _load_project(db, user, project_id)
    if not can(parse_role(membership.role), Action.PROJECT_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")
    try:
        rename_slug(db, project, payload.slug)
    except SlugRefused as error:
        raise HTTPException(status_code=422, detail=error.code)

    org = db.get(Organization, project.org_id)
    return {
        "slug": project.slug,
        "public_url": get_settings().public_base_url.rstrip("/") + public_path(org, project),
    }
```

- [ ] **Step 5: Прогнать бэкенд и закоммитить**

```bash
cd backend && uv run pytest -q
git add backend/app/projects.py backend/app/api/project_routes.py backend/tests/test_slug_api.py
git commit -m "feat: переименование слага проекта"
```

---

### Task 6: Публичное чтение проекта

**Files:**
- Create: `backend/app/api/public_routes.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_public_api.py`

**Interfaces:**
- Consumes: `resolve` (Task 2), `build_state` (Task 3).
- Produces: `GET /api/public/{org_slug}/{project_slug}` → состояние проекта плюс `comments_enabled`.

Свой файл, а не `project_routes.py`: тамошние маршруты все до одного начинаются с `_load_project(db, user, …)`, а здесь пользователя нет вовсе. Соседство двух семейств в одном файле рано или поздно кончается тем, что публичный маршрут по недосмотру получает `Depends(current_user)` и перестаёт быть публичным.

- [ ] **Step 1: Написать падающие тесты**

Создать `backend/tests/test_public_api.py`. Фикстуры `client`/`authed`/`project_id` — как раньше; плюс:

```python
@pytest.fixture
def published(authed, project_id):
    authed.put(
        f"/api/projects/{project_id}/share", json={"published": True, "comments_enabled": True}
    )
    return project_id


def _address(authed, project_id) -> str:
    slug = authed.get(f"/api/projects/{project_id}/settings").json()["slug"]
    return f"/api/public/alex/{slug}"


def test_a_guest_reads_a_published_project_without_a_session(client, authed, published):
    guest = TestClient(app)

    response = guest.get(_address(authed, published))

    assert response.status_code == 200
    assert response.json()["name"] == "Redesign"


def test_a_guest_sees_neither_internal_notes_nor_assignees(client, authed, published):
    category = authed.post(
        f"/api/projects/{published}/mutations",
        json={"op": {"type": "create_category", "name": "Дизайн", "color": "#3b82f6"}},
    ).json()["op"]["category_id"]
    authed.post(
        f"/api/projects/{published}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category,
                "name": "Логотип",
                "start_date": "2026-03-04",
                "duration_days": 5,
                "internal_note": "клиент платит с задержкой",
            }
        },
    )
    guest = TestClient(app)

    task = guest.get(_address(authed, published)).json()["tasks"][0]

    assert "internal_note" not in task
    assert "assignee_ids" not in task
    assert task["end_date"] == "2026-03-10"


def test_an_unpublished_project_is_not_found(client, authed, project_id):
    guest = TestClient(app)

    assert guest.get(_address(authed, project_id)).status_code == 404


def test_a_revoked_address_dies_immediately(client, authed, published):
    guest = TestClient(app)
    assert guest.get(_address(authed, published)).status_code == 200

    authed.put(
        f"/api/projects/{published}/share", json={"published": False, "comments_enabled": True}
    )

    assert guest.get(_address(authed, published)).status_code == 404


def test_unknown_addresses_answer_exactly_like_a_revoked_one(client, authed, published):
    """Разные ответы рассказали бы перебором, какие организации существуют."""
    guest = TestClient(app)

    assert guest.get("/api/public/globex/redesign").status_code == 404
    assert guest.get("/api/public/alex/no-such-project").status_code == 404


def test_the_state_says_whether_comments_are_open(client, authed, published):
    guest = TestClient(app)
    assert guest.get(_address(authed, published)).json()["comments_enabled"] is True

    authed.put(
        f"/api/projects/{published}/share", json={"published": True, "comments_enabled": False}
    )
    assert guest.get(_address(authed, published)).json()["comments_enabled"] is False
```

- [ ] **Step 2: Убедиться, что тесты падают**

```bash
cd backend && uv run pytest tests/test_public_api.py -q
```

- [ ] **Step 3: Написать маршрут**

Создать `backend/app/api/public_routes.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.project_state import build_state
from app.sharing import NotPublished, resolve

# Ни один маршрут этого файла не зависит от current_user, и это его причина
# существовать отдельно от project_routes: там каждый маршрут начинается с
# загрузки проекта по сессии, и публичный маршрут по соседству однажды получил
# бы Depends(current_user) по недосмотру.
router = APIRouter(prefix="/api/public", tags=["public"])


@router.get("/{org_slug}/{project_slug}")
def public_project(org_slug: str, project_slug: str, db: DbSession = Depends(get_db)):
    """Проект глазами гостя: та же раскладка, без заметок и исполнителей."""
    try:
        project, org, link = resolve(db, org_slug, project_slug)
    except NotPublished as error:
        raise HTTPException(status_code=404, detail=error.code)

    state = build_state(db, project, org, show_notes=False, show_assignees=False)
    # Открыты ли комментарии — часть состояния страницы, а не отдельный
    # запрос: иначе форма реплики успевает мелькнуть до того, как выяснится,
    # что она запрещена.
    state["comments_enabled"] = link.comments_enabled
    return state
```

В `backend/app/main.py` — `app.include_router(public_routes.router)`.

- [ ] **Step 4: Прогнать бэкенд и закоммитить**

```bash
cd backend && uv run pytest -q
git add backend/app/api/public_routes.py backend/app/main.py backend/tests/test_public_api.py
git commit -m "feat: публичное чтение проекта"
```

---

### Task 7: Гостевые реплики и ограничитель по адресу

**Files:**
- Create: `backend/app/rate_limit.py`
- Modify: `backend/app/api/public_routes.py`
- Test: `backend/tests/test_rate_limit.py`, `backend/tests/test_public_comments_api.py`

**Interfaces:**
- Produces:
  - `RateLimiter(limit: int, window_seconds: float, now: Callable[[], float] = time.monotonic)` с методом `allow(key: str) -> bool`
  - `GET /api/public/{org}/{project}/comments` → ветка проекта целиком
  - `POST /api/public/{org}/{project}/comments` тело `{body, guest_name}` → 201; 403 `comments_disabled`; 429 `too_many_comments`

Ограничитель держит окно в памяти процесса, а не в базе. Причина не в лени: ключ ограничителя — адрес гостя, а адрес это персональные данные, и хранить их в базе ради счётчика значит завести хранилище персональных данных там, где достаточно счётчика. Плата известна и записана: перезапуск обнуляет окно, а при нескольких процессах у каждого своё. Сегодня контейнер `api` один.

`now` — параметр, а не вызов внутри: иначе проверить истечение окна можно только настоящим ожиданием, и тест на минутное окно идёт минуту.

Право гостя спрашивается у матрицы: `can(None, Action.COMMENT, project_granted=True)`. Роль `None` — это гость, а действующая ссылка и есть тот самый выданный доступ, ради которого в `access.py` заведён `project_granted`.

- [ ] **Step 1: Написать тест ограничителя**

Создать `backend/tests/test_rate_limit.py`:

```python
from app.rate_limit import RateLimiter


def test_allows_up_to_the_limit_and_then_refuses():
    clock = [0.0]
    limiter = RateLimiter(limit=3, window_seconds=60, now=lambda: clock[0])

    assert [limiter.allow("ip") for _ in range(3)] == [True, True, True]
    assert limiter.allow("ip") is False


def test_the_window_slides_rather_than_resetting_on_a_schedule():
    """Окно скользит: три реплики в 12:00:59 не должны обнуляться в 12:01:00
    просто потому, что началась новая минута."""
    clock = [0.0]
    limiter = RateLimiter(limit=2, window_seconds=60, now=lambda: clock[0])

    limiter.allow("ip")
    clock[0] = 59.0
    limiter.allow("ip")
    assert limiter.allow("ip") is False

    clock[0] = 61.0  # первая вышла из окна, вторая ещё в нём
    assert limiter.allow("ip") is True
    assert limiter.allow("ip") is False


def test_keys_are_counted_apart():
    clock = [0.0]
    limiter = RateLimiter(limit=1, window_seconds=60, now=lambda: clock[0])

    assert limiter.allow("first") is True
    assert limiter.allow("second") is True
    assert limiter.allow("first") is False


def test_keys_that_fell_out_of_the_window_stop_taking_memory():
    """Иначе счётчик — это утечка: адресов много, окно короткое, а словарь
    растёт вечно."""
    clock = [0.0]
    limiter = RateLimiter(limit=1, window_seconds=60, now=lambda: clock[0])

    limiter.allow("ip")
    clock[0] = 120.0
    limiter.allow("other")

    assert "ip" not in limiter._hits
```

- [ ] **Step 2: Написать ограничитель**

Создать `backend/app/rate_limit.py`:

```python
import time
from collections import deque
from collections.abc import Callable


class RateLimiter:
    """Скользящее окно по ключу, в памяти процесса.

    В памяти, а не в базе: ключ гостевого ограничителя — его сетевой адрес,
    то есть персональные данные. Хранить их в базе ради счётчика значит
    завести хранилище персональных данных там, где достаточно счётчика.

    Плата принята сознательно: перезапуск обнуляет окна, а при нескольких
    процессах у каждого своё окно, и общий потолок умножается на их число.
    Сегодня контейнер `api` один; когда их станет больше, счётчик переедет в
    общее хранилище — но это будет замена одного класса, а не переделка
    маршрутов.

    `now` — параметр: иначе истечение окна проверяется только настоящим
    ожиданием, и тест минутного окна идёт минуту.
    """

    def __init__(
        self,
        limit: int,
        window_seconds: float,
        now: Callable[[], float] = time.monotonic,
    ):
        self._limit = limit
        self._window = window_seconds
        self._now = now
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str) -> bool:
        moment = self._now()
        self._forget_old(moment)

        hits = self._hits.setdefault(key, deque())
        if len(hits) >= self._limit:
            return False
        hits.append(moment)
        return True

    def _forget_old(self, moment: float) -> None:
        """Иначе счётчик — это утечка: адресов много, окно короткое, а словарь
        растёт вечно. Чистится весь словарь, а не только запрошенный ключ:
        гость, пришедший однажды, второй раз ключ не трогает."""
        edge = moment - self._window
        for key in list(self._hits):
            hits = self._hits[key]
            while hits and hits[0] <= edge:
                hits.popleft()
            if not hits:
                del self._hits[key]
```

```bash
cd backend && uv run pytest tests/test_rate_limit.py -q
```

- [ ] **Step 3: Написать падающие тесты гостевых реплик**

Создать `backend/tests/test_public_comments_api.py` (фикстуры `authed`/`published`/`_address` — как в Task 6):

```python
def test_a_guest_leaves_a_reply_signed_by_the_name_they_gave(client, authed, published):
    guest = TestClient(app)

    response = guest.post(
        f"{_address(authed, published)}/comments",
        json={"body": "А когда сдача?", "guest_name": "Нигяр"},
    )

    assert response.status_code == 201
    assert response.json()["guest_name"] == "Нигяр"
    assert response.json()["author"] is None


def test_guests_and_members_read_the_same_thread(client, authed, published):
    guest = TestClient(app)
    guest.post(
        f"{_address(authed, published)}/comments",
        json={"body": "вопрос гостя", "guest_name": "Нигяр"},
    )
    authed.post(f"/api/projects/{published}/comments", json={"body": "ответ участника"})

    seen_by_guest = [c["body"] for c in guest.get(f"{_address(authed, published)}/comments").json()]

    assert seen_by_guest == ["вопрос гостя", "ответ участника"]


def test_a_reply_without_a_name_is_refused(client, authed, published):
    guest = TestClient(app)

    response = guest.post(
        f"{_address(authed, published)}/comments", json={"body": "аноним", "guest_name": "  "}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "guest_name_required"


def test_replies_are_refused_when_the_owner_switched_comments_off(client, authed, published):
    authed.put(
        f"/api/projects/{published}/share", json={"published": True, "comments_enabled": False}
    )
    guest = TestClient(app)

    response = guest.post(
        f"{_address(authed, published)}/comments", json={"body": "?", "guest_name": "Нигяр"}
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "comments_disabled"


def test_a_revoked_address_takes_the_thread_with_it(client, authed, published):
    guest = TestClient(app)
    authed.put(
        f"/api/projects/{published}/share", json={"published": False, "comments_enabled": True}
    )

    assert guest.get(f"{_address(authed, published)}/comments").status_code == 404


def test_too_many_replies_from_one_address_are_refused(client, authed, published, monkeypatch):
    """Потолок берётся из GUEST_COMMENT_RATE_LIMIT, а не из константы в коде."""
    from app.api import public_routes

    monkeypatch.setattr(public_routes, "_guest_limiter", RateLimiter(limit=2, window_seconds=3600))
    guest = TestClient(app)

    for _ in range(2):
        assert (
            guest.post(
                f"{_address(authed, published)}/comments",
                json={"body": "ещё", "guest_name": "Нигяр"},
            ).status_code
            == 201
        )

    refused = guest.post(
        f"{_address(authed, published)}/comments", json={"body": "и ещё", "guest_name": "Нигяр"}
    )
    assert refused.status_code == 429
    assert refused.json()["detail"] == "too_many_comments"
```

- [ ] **Step 4: Дописать публичные маршруты**

В `backend/app/api/public_routes.py`:

```python
_settings = get_settings()

# Потолок — из настройки, окно — час: «10 реплик» без указания, за какой срок,
# ничего не ограничивает. Живёт в модуле, а не в запросе: счётчик, созданный
# заново на каждый запрос, всегда пуст.
_guest_limiter = RateLimiter(limit=_settings.guest_comment_rate_limit, window_seconds=3600)


class GuestCommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_COMMENT_LEN)
    guest_name: str = Field(min_length=1, max_length=100)


def _open_project(db: DbSession, org_slug: str, project_slug: str):
    try:
        return resolve(db, org_slug, project_slug)
    except NotPublished as error:
        raise HTTPException(status_code=404, detail=error.code)


@router.get("/{org_slug}/{project_slug}/comments")
def public_comments(org_slug: str, project_slug: str, db: DbSession = Depends(get_db)):
    """Обсуждение проекта целиком: та же ветка, что видят участники.

    Ветка задачи наружу не отдаётся — карточки задачи на публичной странице
    нет, и отдавать ленту, которую негде показать, значит расширять поверхность
    без повода.
    """
    project, _org, _link = _open_project(db, org_slug, project_slug)
    comments = list_comments(db, project)
    actors = {...}  # тот же сбор имён, что и в project_routes.list_project_comments
    return [_comment_out(comment, actors) for comment in comments]


@router.post("/{org_slug}/{project_slug}/comments", status_code=201)
def add_public_comment(
    org_slug: str,
    project_slug: str,
    payload: GuestCommentIn,
    request: Request,
    db: DbSession = Depends(get_db),
):
    project, _org, link = _open_project(db, org_slug, project_slug)

    if not link.comments_enabled:
        raise HTTPException(status_code=403, detail="comments_disabled")
    # Роль гостя — None, а выданным доступом служит сама действующая ссылка:
    # ровно тот случай, ради которого в access.py заведён project_granted.
    if not can(None, Action.COMMENT, project_granted=True):
        raise HTTPException(status_code=403, detail="forbidden")

    # Адрес из соединения, а не из X-Forwarded-For: заголовок подделывается
    # одной строкой, и ограничитель, верящий ему, не ограничивает никого. За
    # обратным прокси это адрес прокси — то есть общий потолок на всех гостей;
    # чинится настройкой доверенных прокси, а не доверием к заголовку.
    caller = request.client.host if request.client else "unknown"
    if not _guest_limiter.allow(caller):
        raise HTTPException(status_code=429, detail="too_many_comments")

    name = payload.guest_name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="guest_name_required")

    try:
        comment = add_comment(db, project, body=payload.body, guest_name=name)
    except CommentRefused as error:
        raise HTTPException(status_code=422, detail=error.code)

    return _comment_out(comment, {})
```

`_comment_out` переехал: вынести его из `project_routes.py` в `app/comments.py` (там же, где домен реплик) и импортировать в обоих маршрутных файлах — иначе публичный файл импортирует приватного помощника из соседнего, ровно того сорта связь, ради отсутствия которой файл и заведён.

- [ ] **Step 5: Прогнать бэкенд и закоммитить**

```bash
cd backend && uv run pytest -q
git add backend/app/rate_limit.py backend/app/api/public_routes.py backend/app/comments.py backend/app/api/project_routes.py backend/tests
git commit -m "feat: гостевые реплики и ограничитель по адресу"
```

---

### Task 8: Экран настроек проекта

**Files:**
- Create: `frontend/src/api/sharing.ts`, `frontend/src/screens/ProjectSettings.tsx`, `frontend/src/screens/ProjectSettings.test.tsx`, `frontend/src/screens/settings.css`
- Modify: `frontend/src/AppRoutes.tsx`, `frontend/src/screens/Project.tsx`, `frontend/src/api/errors.ts`, три словаря

**Interfaces:**
- Produces: маршрут `/projects/:projectId/settings`, `settingsQueryKey(projectId)`, `projectSettings`, `setShare`, `checkSlug`, `renameSlug`.

Экран — каркас: сегодня на нём публичная ссылка и слаг, завтра сюда лягут дедлайн, часовой пояс и календарь. Поэтому разделы, а не одна форма.

Ссылку показывает поле только для чтения плюс кнопка «скопировать», а не голый текст: адрес длинный, и выделять его мышью из абзаца — работа, которую делает одна кнопка.

- [ ] **Step 1: Написать падающие тесты**

`frontend/src/screens/ProjectSettings.test.tsx` — проверить: адрес виден до публикации; переключатель публикации шлёт `{published, comments_enabled}`; выключение комментариев шлёт то же с `comments_enabled: false`; занятый слаг показывает подсказанный вариант и не отправляет форму; успешное переименование меняет показанный адрес; человеку без права администрирования проекта экран отвечает объяснением, а не пустой формой.

Оснастка — в стиле `src/test/project.ts`: обработчики `GET /api/projects/p1/settings`, `PUT /api/projects/p1/share`, `GET /api/projects/p1/slug-check`, `PUT /api/projects/p1/slug`.

- [ ] **Step 2: Клиент**

`frontend/src/api/sharing.ts` — типы `ProjectSettings = {slug, public_url, public_sharing_enabled, share: {published, comments_enabled}}`, функции `projectSettings(id)`, `setShare(id, {published, comments_enabled})`, `checkSlug(id, slug)`, `renameSlug(id, slug)`. Ключ — `["project", id, "settings"]`, под тем же префиксом, что и остальное поддерево проекта.

- [ ] **Step 3: Экран**

`ProjectSettings.tsx`: заголовок с названием проекта, раздел «Публичная ссылка» (адрес только для чтения + «Скопировать», переключатель публикации, переключатель комментариев — неактивный, пока не опубликовано), раздел «Адрес» (поле слага, живая проверка с подсказкой, кнопка «Сохранить»), и предупреждение о том, что переименование слага убивает прежний адрес: человек обязан узнать об этом до нажатия, а не от клиента, у которого перестала открываться ссылка.

Копирование — `navigator.clipboard.writeText`; отсутствие API (старый браузер, не-https) не должно ронять экран: кнопка тогда просто не показывается, а поле остаётся выделяемым.

- [ ] **Step 4: Маршрут и вход на экран**

В `AppRoutes.tsx` — `<Route path="/projects/:projectId/settings" element={<ProjectSettings />} />` внутри `RequireAuth`. В `Project.tsx` — ссылка «Настройки» в `screen__actions`, видимая только при `canWrite`.

- [ ] **Step 5: Словари и коды отказов**

Ключи `settings.*` в трёх словарях; коды `slug_taken`, `slug_empty`, `public_sharing_disabled`, `not_published` — в `PLAIN_CODES` и в блок `error` всех трёх словарей.

- [ ] **Step 6: Проверить и закоммитить**

```bash
cd frontend && npx vitest run --maxWorkers=2 && npm run lint && npx tsc -b
git add frontend/src && git commit -m "feat: экран настроек проекта"
```

---

### Task 9: Публичная страница

**Files:**
- Create: `frontend/src/api/public.ts`, `frontend/src/screens/PublicProject.tsx`, `frontend/src/screens/PublicProject.test.tsx`, `frontend/src/public/guestName.ts`
- Modify: `frontend/src/AppRoutes.tsx`, `frontend/src/task/Comments.tsx`, три словаря

**Interfaces:**
- Consumes: `GET/POST /api/public/{org}/{project}[/comments]`.
- Produces: маршрут `/p/:orgSlug/:projectSlug`, `rememberedGuestName()` / `rememberGuestName(name)`.

Страница лежит **вне** `RequireAuth`: у гостя нет сессии, и проверять её значило бы отправить его на вход. Шапки приложения на ней тоже нет — вместо неё название организации и переключатель языка: «Выйти» гостю предлагать неоткуда.

Диаграмма — тот же `<Gantt>` с `canWrite={false}` и без `onSelectTask`: карточки задачи на публичной странице нет. Внутренних заметок нет в ответе, поэтому и в разметке им взяться неоткуда — решение принял сервер.

Обсуждение — ветка проекта целиком, та самая, которую план 4 научился отдавать, но которой негде было показаться.

Имя гостя запрашивается один раз и запоминается в браузере (`localStorage`, ключ `flowline_guest_name`). Не в куке: сервер его не спрашивает, а кука уезжала бы с каждым запросом впустую.

- [ ] **Step 1: Написать падающие тесты**

`PublicProject.test.tsx` — проверить: страница открывается без сессии и показывает диаграмму; внутренних заметок в разметке нет; при `comments_enabled: false` формы реплики нет вовсе; первая реплика спрашивает имя и шлёт `{body, guest_name}`; имя, сохранённое в браузере, больше не спрашивается; 404 показывает объяснение «ссылка не действует», а не пустой экран; отказ 429 объясняется словами.

- [ ] **Step 2: Память об имени**

`frontend/src/public/guestName.ts` — чтение и запись `localStorage` с защитой от исключения: в приватном режиме некоторых браузеров обращение к `localStorage` бросает, и страница не должна из-за этого падать целиком.

- [ ] **Step 3: Клиент и страница**

`api/public.ts`: `publicProjectQueryKey(org, project)`, `getPublicProject`, `listPublicComments`, `postPublicComment`. Тип состояния — `ProjectState & { comments_enabled: boolean }`, где `tasks[].internal_note` и `assignee_ids` необязательны.

`PublicProject.tsx`: три состояния (ожидание, отказ, страница), шапка с названием организации и `<LocaleSwitch />`, `<Gantt canWrite={false} />`, ветка обсуждения с формой, в которой рядом с полем реплики стоит поле имени — оно показывается, только пока имя не запомнено.

- [ ] **Step 4: Разделить ветку обсуждения**

`Comments.tsx` из плана 4 умеет только ветку задачи под сессией. Публичной странице нужна ветка проекта под публичными маршрутами. Вынести разметку ветки в `CommentThread` (принимает список реплик, состояние отправки и слот под поля формы), а `Comments` и публичная страница пусть будут двумя её вызывающими. Разметка одна — иначе реплика гостя и реплика участника разойдутся по виду, хотя это одна и та же реплика.

- [ ] **Step 5: Маршрут**

В `AppRoutes.tsx`, **вне** `RequireAuth` и **до** `*`:

```tsx
      <Route path="/p/:orgSlug/:projectSlug" element={<PublicProject />} />
```

- [ ] **Step 6: Проверить и закоммитить**

```bash
cd frontend && npx vitest run --maxWorkers=2 && npm run lint && npx tsc -b
git add frontend/src && git commit -m "feat: публичная страница проекта"
```

---

## Что осталось за границей плана

- **Карточка задачи на публичной странице.** Гость видит диаграмму и обсуждение проекта; ветка отдельной задачи наружу не отдаётся.
- **Живые обновления.** Спецификация обещает гостю движение полосок без перезагрузки по WebSocket — это отдельный план.
- **Редактирование слага организации.** Он входит в адрес, но живёт в настройках организации, которых ещё нет.
- **Остальные настройки проекта** (дедлайн, часовой пояс, рабочие дни, праздники) — экран под них готов, endpoint'ов нет.
- **Общий ограничитель на несколько процессов.** Окно живёт в памяти процесса; при масштабировании `api` потолок умножается на число процессов.
