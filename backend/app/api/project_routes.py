import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, needs_project_grant, parse_role, visible_op
from app.calendar import CalendarError, end_date
from app.db import get_db
from app.invitations import granted_project_ids, has_project_access
from app.models import (
    Category,
    Dependency,
    Membership,
    Organization,
    Project,
    Revision,
    Task,
    TaskAssignee,
    User,
)
from app.mutations import InvalidOperation, NotFoundInProject, PublicOp, apply_op, to_internal
from app.orgs import current_membership
from app.projects import create_project as create_project_entity
from app.settings_resolution import project_calendar, resolve_shift_threshold, resolve_timezone

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectOut(BaseModel):
    id: str
    name: str
    slug: str


def _load_project(
    db: DbSession, membership: Membership, project_id: uuid.UUID
) -> tuple[Project, bool]:
    """Проект и признак «доступ к нему выдан поимённо».

    Второе спрашивается здесь, а не в каждом маршруте по отдельности: у роли
    `client` без выданного доступа права на проект нет вовсе, и место, где это
    выясняется, должно быть тем же самым, где проект находится.
    """
    project = db.get(Project, project_id)
    # чужой проект неотличим от несуществующего: 404, а не 403
    if project is None or project.org_id != membership.org_id:
        raise HTTPException(status_code=404, detail="project_not_found")
    granted = needs_project_grant(parse_role(membership.role)) and has_project_access(
        db, user_id=membership.user_id, project_id=project.id
    )
    return project, granted


def _require_project_read(membership: Membership, granted: bool) -> None:
    """Единственное место, где решается право на чтение: спрашивает access,
    не сравнивает роль напрямую. Отказ — 404, а не 403, тем же принципом,
    что и в _load_project: клиент без выданного доступа к проекту не должен
    отличить существующий проект от несуществующего."""
    if not can(parse_role(membership.role), Action.PROJECT_READ, project_granted=granted):
        raise HTTPException(status_code=404, detail="project_not_found")


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectIn,
    membership: Membership = Depends(current_membership),
    db: DbSession = Depends(get_db),
):
    if not can(parse_role(membership.role), Action.PROJECT_WRITE):
        raise HTTPException(status_code=403, detail="forbidden")

    project = create_project_entity(db, org_id=membership.org_id, name=payload.name)
    return ProjectOut(id=str(project.id), name=project.name, slug=project.slug)


@router.get("", response_model=list[ProjectOut])
def list_projects(
    membership: Membership = Depends(current_membership), db: DbSession = Depends(get_db)
):
    """Проекты организации — или те из них, куда позвали поимённо.

    Роль `client` списка организации не видит: для неё этот маршрут отдаёт
    ровно её проекты, а не отказ. Пустой список у того, кого ещё никуда не
    позвали, — честный ответ: проектов, которые он вправе открыть, нет.
    """
    granted_only = needs_project_grant(parse_role(membership.role))
    # Для роли, которой нужен явный доступ, право читать проверяется не этой
    # строкой, а фильтром ниже: сам список ей доступен, а его содержимое —
    # ровно те проекты, куда её позвали.
    _require_project_read(membership, granted=granted_only)

    query = select(Project).where(Project.org_id == membership.org_id)
    if granted_only:
        query = query.where(Project.id.in_(granted_project_ids(db, user_id=membership.user_id)))
    projects = db.scalars(query).all()
    return [ProjectOut(id=str(p.id), name=p.name, slug=p.slug) for p in projects]


@router.get("/{project_id}")
def get_project(
    project_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: DbSession = Depends(get_db),
):
    project, granted = _load_project(db, membership, project_id)
    _require_project_read(membership, granted)
    org = db.get(Organization, project.org_id)
    calendar = project_calendar(project, org)
    show_notes = can(
        parse_role(membership.role), Action.READ_INTERNAL_NOTE, project_granted=granted
    )

    # Позиции могут совпадать в одном крайнем случае (строка, восстановленная
    # отменой на позицию, которую с тех пор занял другой ряд), поэтому id —
    # обязательный второй ключ сортировки, а не только position.
    categories = db.scalars(
        select(Category)
        .where(Category.project_id == project.id)
        .order_by(Category.position, Category.id)
    ).all()
    tasks = db.scalars(
        select(Task).where(Task.project_id == project.id).order_by(Task.position, Task.id)
    ).all()

    # Один запрос на весь проект, а не по запросу на задачу: на сотне задач
    # второе дало бы сотню запросов ради одного экрана.
    assignees: dict[str, list[str]] = {str(t.id): [] for t in tasks}
    for task_id, user_id in db.execute(
        select(TaskAssignee.task_id, TaskAssignee.user_id)
        .join(Task, Task.id == TaskAssignee.task_id)
        .where(Task.project_id == project.id)
        .order_by(TaskAssignee.user_id)
    ).all():
        assignees[str(task_id)].append(str(user_id))

    dependencies = db.execute(
        select(Dependency.from_task_id, Dependency.to_task_id)
        .where(Dependency.project_id == project.id)
        .order_by(Dependency.from_task_id, Dependency.to_task_id)
    ).all()

    try:
        ends = [end_date(t.start_date, t.duration_days, calendar) for t in tasks]
    except CalendarError as error:
        # Той же формы, что и отказы мутаций: 422 с машинным кодом. Раньше
        # здесь была голая пятисотка — вырожденную маску задаёт человек, и
        # проект переставал читаться без объяснения.
        raise HTTPException(status_code=422, detail=error.code)

    return {
        "id": str(project.id),
        "name": project.name,
        "slug": project.slug,
        "deadline": project.deadline.isoformat() if project.deadline else None,
        # Максимум по датам окончания задач; пустой проект не имеет конца.
        "project_end": max(ends).isoformat() if ends else None,
        # Календарь едет вместе с состоянием: интерфейс заливает нерабочие дни
        # и рисует выходные ещё до первого клика, а не догадывается о них.
        "calendar": {
            "working_days": calendar.working_days,
            "holidays": sorted(d.isoformat() for d in calendar.holidays),
            "extra_workdays": sorted(d.isoformat() for d in calendar.extra_workdays),
        },
        # Разрешённые значения, а не сырые nullable-колонки проекта: кто их
        # унаследовал от организации, а кто задал сам — не дело интерфейса.
        "settings": {
            "shift_threshold_days": resolve_shift_threshold(project, org),
            "timezone": resolve_timezone(project, org),
        },
        "categories": [
            {"id": str(c.id), "name": c.name, "color": c.color, "position": c.position}
            for c in categories
        ],
        "tasks": [
            {
                "id": str(t.id),
                "category_id": str(t.category_id),
                "name": t.name,
                "description": t.description,
                "start_date": t.start_date.isoformat(),
                "duration_days": t.duration_days,
                "end_date": task_end.isoformat(),
                "criticality": t.criticality,
                "progress_pct": t.progress_pct,
                "position": t.position,
                "assignee_ids": assignees[str(t.id)],
                **({"internal_note": t.internal_note} if show_notes else {}),
            }
            for t, task_end in zip(tasks, ends)
        ],
        "dependencies": [
            {"from_task_id": str(source), "to_task_id": str(target)}
            for source, target in dependencies
        ],
    }


@router.get("/{project_id}/revisions")
def list_revisions(
    project_id: uuid.UUID,
    task_id: uuid.UUID | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    membership: Membership = Depends(current_membership),
    db: DbSession = Depends(get_db),
):
    """Журнал изменений проекта, при желании — одной задачи.

    Запись отдаётся параметрами, а не готовой фразой: язык читателя решается в
    браузере, и один и тот же перенос обязан читаться на трёх языках. Сервер
    словарей сообщений не держит сознательно (см. MutationError).

    Обратная операция наружу не выходит: она нужна отмене, а отмены пока нет.
    Отдавать её «на будущее» значило бы удваивать вес ленты и заодно удваивать
    поверхность, на которой заметка может утечь.
    """
    project, granted = _load_project(db, membership, project_id)
    _require_project_read(membership, granted)

    query = select(Revision).where(Revision.project_id == project.id)
    if task_id is not None:
        # Поиск по содержимому jsonb — то, ради чего колонка и объявлена jsonb:
        # выбирать все ревизии проекта и отсеивать их в Python значило бы
        # тащить журнал целиком ради одной карточки.
        query = query.where(Revision.op["task_id"].astext == str(task_id))
    # Новые сверху: ленту читают с последнего события. seq, а не created_at, —
    # две операции одной секунды по времени неразличимы, а по номеру всегда.
    revisions = db.scalars(query.order_by(Revision.seq.desc()).limit(limit)).all()

    actors = {
        row.id: row.name
        for row in db.scalars(
            select(User).where(
                User.id.in_({r.actor_user_id for r in revisions if r.actor_user_id})
            )
        ).all()
    }

    role = parse_role(membership.role)
    return [
        {
            "seq": revision.seq,
            "created_at": revision.created_at.isoformat(),
            # Автора может не быть: операции AI и системные записи идут без
            # человека, и выдумывать им автора нельзя.
            "actor": (
                {"id": str(revision.actor_user_id), "name": actors[revision.actor_user_id]}
                if revision.actor_user_id in actors
                else None
            ),
            # Причина — текст человека: отдаётся как есть и не переводится.
            "reason": revision.reason,
            "op": visible_op(revision.op, role, project_granted=granted),
        }
        for revision in revisions
    ]


@router.post("/{project_id}/mutations", status_code=201)
def apply_mutation(
    project_id: uuid.UUID,
    op: PublicOp = Body(..., embed=True),
    reason: str | None = Body(default=None),
    membership: Membership = Depends(current_membership),
    db: DbSession = Depends(get_db),
):
    project, granted = _load_project(db, membership, project_id)
    # Выданный доступ к проекту открывает чтение, но не правку: роли, которым
    # он нужен, права писать не имеют ни при каком доступе.
    if not can(parse_role(membership.role), Action.PROJECT_WRITE, project_granted=granted):
        raise HTTPException(status_code=403, detail="forbidden")

    try:
        revision = apply_op(
            db, project, to_internal(op), actor_id=membership.user_id, reason=reason
        )
    except NotFoundInProject as error:
        # Сущность чужого проекта — не ошибка формата запроса: 404 тем же
        # принципом, что и в _load_project.
        raise HTTPException(status_code=404, detail=error.code)
    except InvalidOperation as error:
        raise HTTPException(status_code=422, detail=error.code)

    role = parse_role(membership.role)
    return {
        "seq": revision.seq,
        "op": visible_op(revision.op, role, project_granted=granted),
        "inverse": visible_op(revision.inverse, role, project_granted=granted),
    }
