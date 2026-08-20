"""Импорт проекта из Jira и повторная синхронизация — сборка мутаций.

Импорт заводит новый проект Planora пачкой обычных мутаций с общим
`batch_id`, тем же приёмом, что применение черновика AI (см.
app.ai.intake.apply_draft): история задач, заведённых из Jira, не отличается
от истории любых других, и всю пачку отменяет одна кнопка «Отменить». Эпики
Jira становятся категориями, остальные задачи — строками плана; задача без
эпика уходит в категорию по умолчанию.

Синхронизация повторяет тот же обход по сохранённому запросу (JQL) и решает
для каждой строки: не заведена — создать, заведена и разошлась — обновить
изменившиеся поля, заведена и совпадает — пропустить. Она **не**:
  - удаляет локально задачи/категории, исчезнувшие из выборки Jira (Jira не
    источник правды об удалении — человек мог намеренно вычеркнуть строку
    здесь, оставив её в Jira открытой);
  - переносит задачу в другую категорию, если её эпик в Jira сменился
    (перенос — это reorder_task, который спрашивает новую позицию, а
    угадывать место в чужом списке задач не дело автоматической синхронизации);
  - понижает веху обратно в обычную задачу, если тип задачи в Jira сменился.
Обновление уже заведённых дат и статусов при этом происходит: Jira для
привязанного проекта — источник правды по срокам и статусам, а не Planora.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.jira.client import ISSUE_FIELDS, JiraClient
from app.jira.errors import JiraError
from app.jira.mapping import (
    IssueTaskFields,
    epic_key_of,
    find_epic_link_field,
    is_epic,
    issue_summary,
    task_fields_from_issue,
)
from app.models import (
    Category,
    JiraCategoryLink,
    JiraProjectLink,
    JiraTaskLink,
    Organization,
    Project,
    ScheduleMode,
    Task,
    User,
)
from app.mutations import (
    CreateCategory,
    CreateTask,
    RenameCategory,
    ResizeTask,
    SetCriticality,
    SetMilestone,
    SetStatus,
    SetTaskFields,
    apply_op,
)
from app.projects import create_project
from app.settings_resolution import project_calendar

# Палитра — оформление, не данные: тот же короткий набор шести цветов, что
# предлагает форма создания категории вручную и применение черновика AI (см.
# app/ai/intake.py:_COLORS). Общего модуля ради шести строк не заводим —
# он был бы тяжелее, чем цена нести палитру трижды.
_COLORS = ("#3b82f6", "#a855f7", "#f97316", "#10b981", "#ef4444", "#eab308")

_DEFAULT_CATEGORY_NAME = {"ru": "Без эпика", "az": "Epiksiz", "en": "No epic"}

#: Ключ привязки категории по умолчанию — не ключ задачи Jira (в Jira таких
#: ключей не бывает: они всегда `ПРОЕКТ-число`), а значит не столкнётся ни с
#: одним настоящим эпиком. Нужен, чтобы повторная синхронизация находила уже
#: заведённую категорию по умолчанию по привязке, а не по имени: имя завязано
#: на локаль запускающего, а привязка — нет.
_NO_EPIC_LINK_KEY = "__no_epic__"


def _color(index: int) -> str:
    return _COLORS[index % len(_COLORS)]


def _default_category_name(locale: str) -> str:
    return _DEFAULT_CATEGORY_NAME.get(locale, _DEFAULT_CATEGORY_NAME["az"])


def default_jql(jira_project_key: str) -> str:
    """Запрос по умолчанию: весь проект, от старых задач к новым."""
    return f'project = "{jira_project_key}" ORDER BY created ASC'


def _now() -> datetime:
    return datetime.now(UTC)


def resolve_epic_link_field(client: JiraClient) -> str | None:
    """Id пользовательского поля «Epic Link», если оно есть у инстанса.

    Отказ здесь не должен ронять импорт целиком — на части инстансов список
    полей недоступен без прав администратора, а без поля эпик team-managed
    проектов (обычный `parent`) продолжает определяться. Классические
    (company-managed) проекты в этом случае просто не находят эпик через
    старое поле и попадают в категорию по умолчанию — план от этого не
    ломается, только беднее размечен.
    """
    try:
        return find_epic_link_field(client.list_fields())
    except JiraError:
        return None


@dataclass
class SyncResult:
    created_categories: int = 0
    created_tasks: int = 0
    updated_tasks: int = 0


def _fetch_issues(client: JiraClient, jql: str, epic_link_field: str | None, limit: int) -> list[dict]:
    fields = list(ISSUE_FIELDS)
    if epic_link_field:
        fields.append(epic_link_field)
    return client.search_issues(jql, fields=fields, max_results=limit)


class _CategoryAssigner:
    """Категория для задачи: по эпику, если он заведён, иначе — по умолчанию.

    Категория по умолчанию заводится лениво, первой задачей без эпика: план,
    где у каждой задачи есть эпик, не должен получать пустой лишний этап.
    """

    def __init__(
        self,
        db: DbSession,
        project: Project,
        *,
        by_epic_key: dict[str, uuid.UUID],
        existing_default_id: uuid.UUID | None,
        locale: str,
        next_color_index: int,
        actor: User,
        batch_id: uuid.UUID,
        reason: str | None,
    ):
        self._db = db
        self._project = project
        self._by_epic_key = by_epic_key
        self._default_id = existing_default_id
        self._locale = locale
        self._color_index = next_color_index
        self._actor = actor
        self._batch_id = batch_id
        self._reason = reason
        self.created_default = False

    def for_issue(self, issue: dict, epic_link_field: str | None) -> uuid.UUID:
        epic_key = epic_key_of(issue, epic_link_field)
        if epic_key is not None and epic_key in self._by_epic_key:
            return self._by_epic_key[epic_key]
        if self._default_id is None:
            revision = apply_op(
                self._db,
                self._project,
                CreateCategory(
                    name=_default_category_name(self._locale), color=_color(self._color_index)
                ),
                actor_id=self._actor.id,
                batch_id=self._batch_id,
                reason=self._reason,
            )
            self._default_id = uuid.UUID(revision.op["category_id"])
            self._db.add(
                JiraCategoryLink(
                    project_id=self._project.id,
                    category_id=self._default_id,
                    issue_key=_NO_EPIC_LINK_KEY,
                )
            )
            self.created_default = True
        return self._default_id

    @property
    def default_category_id(self) -> uuid.UUID | None:
        return self._default_id


def _sync_categories(
    db: DbSession,
    project: Project,
    epics: list[dict],
    existing: dict[str, JiraCategoryLink],
    *,
    actor: User,
    batch_id: uuid.UUID,
    reason: str | None,
) -> tuple[dict[str, uuid.UUID], int]:
    by_key: dict[str, uuid.UUID] = {}
    created = 0
    for index, epic in enumerate(epics):
        key = epic.get("key")
        link = existing.get(key)
        name = issue_summary(epic)
        category = db.get(Category, link.category_id) if link is not None else None
        # Категория могла быть удалена вручную с тех пор — привязка тогда
        # осиротела. Задачи этого эпика создавать всё равно нужно (Jira его
        # не удаляла), поэтому здесь заводится новая категория заново — в
        # отличие от JiraTaskLink ниже: там осиротевшая привязка молча
        # пропускается, потому что удаление задачи человек мог сделать
        # осознанно, а категория без единой строки такого решения не несёт.
        if link is not None and category is None:
            db.delete(link)
        if category is None:
            revision = apply_op(
                db,
                project,
                CreateCategory(name=name, color=_color(index)),
                actor_id=actor.id,
                batch_id=batch_id,
                reason=reason,
            )
            category_id = uuid.UUID(revision.op["category_id"])
            db.add(JiraCategoryLink(project_id=project.id, category_id=category_id, issue_key=key))
            created += 1
        else:
            category_id = category.id
            if category.name != name:
                apply_op(
                    db,
                    project,
                    RenameCategory(category_id=category_id, name=name),
                    actor_id=actor.id,
                    batch_id=batch_id,
                    reason=reason,
                )
        by_key[key] = category_id
    return by_key, created


def _task_needs_update(task: Task, fields: IssueTaskFields) -> bool:
    return (
        task.name != fields.name
        or task.description != fields.description
        or task.criticality != fields.criticality
        or task.status != fields.status
        or (fields.milestone and not task.milestone)
        or (not fields.milestone and (task.start_date != fields.start_date or task.duration_days != fields.duration_days))
    )


def _apply_task_update(
    db: DbSession,
    project: Project,
    task: Task,
    fields: IssueTaskFields,
    *,
    actor: User,
    batch_id: uuid.UUID,
    reason: str | None,
) -> None:
    if task.name != fields.name or task.description != fields.description:
        apply_op(
            db,
            project,
            SetTaskFields(
                task_id=task.id,
                name=fields.name,
                description=fields.description,
                internal_note=task.internal_note,
            ),
            actor_id=actor.id,
            batch_id=batch_id,
            reason=reason,
        )
    if task.criticality != fields.criticality:
        apply_op(
            db,
            project,
            SetCriticality(task_id=task.id, criticality=fields.criticality),
            actor_id=actor.id,
            batch_id=batch_id,
            reason=reason,
        )
    # Веху только повышают, никогда не понижают — см. докстринг модуля.
    if fields.milestone and not task.milestone:
        apply_op(
            db,
            project,
            SetMilestone(task_id=task.id, milestone=True),
            actor_id=actor.id,
            batch_id=batch_id,
            reason=reason,
        )
    if not task.milestone and not fields.milestone and (
        task.start_date != fields.start_date or task.duration_days != fields.duration_days
    ):
        apply_op(
            db,
            project,
            ResizeTask(
                task_id=task.id, start_date=fields.start_date, duration_days=fields.duration_days
            ),
            actor_id=actor.id,
            batch_id=batch_id,
            reason=reason,
        )
    if task.status != fields.status:
        apply_op(
            db,
            project,
            SetStatus(task_id=task.id, status=fields.status),
            actor_id=actor.id,
            batch_id=batch_id,
            reason=reason,
        )


def _sync_tasks(
    db: DbSession,
    project: Project,
    others: list[dict],
    category_by_epic: dict[str, uuid.UUID],
    existing: dict[str, JiraTaskLink],
    *,
    epic_link_field: str | None,
    calendar,
    locale: str,
    default_category_id: uuid.UUID | None,
    color_index: int,
    actor: User,
    batch_id: uuid.UUID,
    reason: str | None,
) -> tuple[int, int, bool]:
    """Возвращает (создано задач, обновлено задач, заведена ли новая
    категория по умолчанию)."""
    assigner = _CategoryAssigner(
        db,
        project,
        by_epic_key=category_by_epic,
        existing_default_id=default_category_id,
        locale=locale,
        next_color_index=color_index,
        actor=actor,
        batch_id=batch_id,
        reason=reason,
    )
    created = updated = 0
    for issue in others:
        key = issue.get("key")
        fields = task_fields_from_issue(issue, calendar)
        link = existing.get(key)
        if link is None:
            category_id = assigner.for_issue(issue, epic_link_field)
            revision = apply_op(
                db,
                project,
                CreateTask(
                    category_id=category_id,
                    name=fields.name,
                    description=fields.description,
                    start_date=fields.start_date,
                    duration_days=fields.duration_days,
                    criticality=fields.criticality,
                    status=fields.status,
                    progress_pct=fields.progress_pct,
                    milestone=fields.milestone,
                ),
                actor_id=actor.id,
                batch_id=batch_id,
                reason=reason,
            )
            task_id = uuid.UUID(revision.op["task_id"])
            db.add(JiraTaskLink(project_id=project.id, task_id=task_id, issue_key=key))
            created += 1
            continue

        if link.task_id is None:
            # Задача удалена локально с тех пор — привязка осталась
            # надгробием (task_id обнулён FK SET NULL, см. модель) вместо
            # того, чтобы воскрешать задачу заново: решение избавиться от
            # строки плана отдаём человеку, который его принял.
            continue
        task = db.get(Task, link.task_id)
        if _task_needs_update(task, fields):
            _apply_task_update(db, project, task, fields, actor=actor, batch_id=batch_id, reason=reason)
            updated += 1

    return created, updated, assigner.created_default


def _sync(
    db: DbSession,
    project: Project,
    client: JiraClient,
    jql: str,
    *,
    actor: User,
    reason: str | None,
    existing_category_links: dict[str, JiraCategoryLink],
    existing_task_links: dict[str, JiraTaskLink],
) -> tuple[SyncResult, uuid.UUID]:
    org = db.get(Organization, project.org_id)
    calendar = project_calendar(project, org)
    epic_link_field = resolve_epic_link_field(client)

    issues = _fetch_issues(client, jql, epic_link_field, get_settings().jira_max_issues_per_sync)
    epics = [issue for issue in issues if is_epic(issue)]
    others = [issue for issue in issues if not is_epic(issue)]

    batch_id = uuid.uuid4()
    category_by_epic, created_categories = _sync_categories(
        db, project, epics, existing_category_links, actor=actor, batch_id=batch_id, reason=reason
    )
    default_link = existing_category_links.get(_NO_EPIC_LINK_KEY)
    default_category_id = default_link.category_id if default_link else None
    # Та же проверка на осиротевшую привязку, что и у эпиков в
    # _sync_categories: категорию по умолчанию тоже могли удалить вручную.
    if default_link is not None and db.get(Category, default_link.category_id) is None:
        db.delete(default_link)
        default_category_id = None

    created_tasks, updated_tasks, created_default_category = _sync_tasks(
        db,
        project,
        others,
        category_by_epic,
        existing_task_links,
        epic_link_field=epic_link_field,
        calendar=calendar,
        locale=actor.locale,
        default_category_id=default_category_id,
        color_index=len(epics),
        actor=actor,
        batch_id=batch_id,
        reason=reason,
    )

    result = SyncResult(
        created_categories=created_categories + (1 if created_default_category else 0),
        created_tasks=created_tasks,
        updated_tasks=updated_tasks,
    )
    return result, batch_id


def import_project(
    db: DbSession,
    *,
    org: Organization,
    client: JiraClient,
    jira_project_key: str,
    name: str,
    jql: str | None,
    actor: User,
) -> tuple[Project, uuid.UUID, SyncResult]:
    """Заводит проект Planora по проекту Jira. Ничего не создаёт, если Jira
    не отвечает или запрос не находит ни одной задачи — пустой проект без
    единой строки был бы хуже честного отказа."""
    query = jql or default_jql(jira_project_key)
    project = create_project(db, org_id=org.id, name=name)
    # План с настоящими датами Jira — календарный, не относительный, тем же
    # решением, что применение черновика AI (см. app.ai.intake.apply_draft).
    project.schedule_mode = ScheduleMode.CALENDAR
    db.flush()

    result, batch_id = _sync(
        db,
        project,
        client,
        query,
        actor=actor,
        reason=None,
        existing_category_links={},
        existing_task_links={},
    )
    db.add(
        JiraProjectLink(
            project_id=project.id, jira_project_key=jira_project_key, jql=query, last_synced_at=_now()
        )
    )
    db.flush()
    return project, batch_id, result


def sync_project(
    db: DbSession,
    *,
    org: Organization,
    client_factory: Callable[[], JiraClient],
    project: Project,
    actor: User,
) -> tuple[SyncResult, uuid.UUID]:
    """Повторная синхронизация уже заведённого проекта — см. докстринг модуля
    о том, чего она не делает.

    Клиента строит `client_factory`, а не готовый объект: связь с Jira можно
    было отключить в настройках уже после того, как этот проект из неё
    завели, и «проект не привязан» — более точный отказ для непривязанного
    проекта, чем «Jira не подключена», даже если оба условия верны разом.
    Поэтому привязка проверяется раньше, чем строится клиент.
    """
    link = db.scalar(select(JiraProjectLink).where(JiraProjectLink.project_id == project.id))
    if link is None:
        raise JiraError("jira_not_linked", "проект не заведён из Jira")
    client = client_factory()

    existing_categories = {
        row.issue_key: row
        for row in db.scalars(
            select(JiraCategoryLink).where(JiraCategoryLink.project_id == project.id)
        )
    }
    existing_tasks = {
        row.issue_key: row
        for row in db.scalars(select(JiraTaskLink).where(JiraTaskLink.project_id == project.id))
    }

    reason = f"Синхронизация с Jira ({link.jira_project_key})"
    result, batch_id = _sync(
        db,
        project,
        client,
        link.jql,
        actor=actor,
        reason=reason,
        existing_category_links=existing_categories,
        existing_task_links=existing_tasks,
    )
    link.last_synced_at = _now()
    db.flush()
    return result, batch_id
