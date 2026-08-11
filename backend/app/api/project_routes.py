import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, parse_role, visible_op
from app.auth import current_user
from app.calendar import CalendarError, end_date
from app.db import get_db
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
from app.mutations import (
    InvalidOperation,
    NotFoundInProject,
    PublicOp,
    ReasonRequired,
    apply_op,
    to_internal,
)
from app.plans import approve_plan, plan_versions
from app.projects import create_project as create_project_entity
from app.settings_resolution import project_calendar, resolve_shift_threshold, resolve_timezone

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectOut(BaseModel):
    id: str
    name: str
    slug: str


def _membership(db: DbSession, user: User) -> Membership:
    # Человек может состоять в нескольких организациях; переключателя ещё
    # нет, и маршрут берёт первую. Порядок задан явно, чтобы «первая» была
    # хотя бы одной и той же от запроса к запросу, а не той, что первой
    # вернул планировщик.
    membership = db.scalar(
        select(Membership).where(Membership.user_id == user.id).order_by(Membership.id)
    )
    if membership is None:
        raise HTTPException(status_code=403, detail="no_organization")
    return membership


def _load_project(db: DbSession, user: User, project_id: uuid.UUID) -> tuple[Project, Membership]:
    membership = _membership(db, user)
    project = db.get(Project, project_id)
    # чужой проект неотличим от несуществующего: 404, а не 403
    if project is None or project.org_id != membership.org_id:
        raise HTTPException(status_code=404, detail="project_not_found")
    return project, membership


def _require_project_read(membership: Membership) -> None:
    """Единственное место, где решается право на чтение: спрашивает access,
    не сравнивает роль напрямую. Отказ — 404, а не 403, тем же принципом,
    что и в _load_project: клиент без выданного доступа к проекту не должен
    отличить существующий проект от несуществующего."""
    if not can(parse_role(membership.role), Action.PROJECT_READ):
        raise HTTPException(status_code=404, detail="project_not_found")


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    membership = _membership(db, user)
    if not can(parse_role(membership.role), Action.PROJECT_WRITE):
        raise HTTPException(status_code=403, detail="forbidden")

    project = create_project_entity(db, org_id=membership.org_id, name=payload.name)
    return ProjectOut(id=str(project.id), name=project.name, slug=project.slug)


@router.get("", response_model=list[ProjectOut])
def list_projects(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    membership = _membership(db, user)
    _require_project_read(membership)
    projects = db.scalars(select(Project).where(Project.org_id == membership.org_id)).all()
    return [ProjectOut(id=str(p.id), name=p.name, slug=p.slug) for p in projects]


@router.get("/{project_id}")
def get_project(
    project_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    project, membership = _load_project(db, user, project_id)
    _require_project_read(membership)
    org = db.get(Organization, project.org_id)
    calendar = project_calendar(project, org)
    show_notes = can(parse_role(membership.role), Action.READ_INTERNAL_NOTE)

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
        # Конец базового плана считает сервер по тому же календарю, что и
        # текущий: призрак под полоской обязан стоять там же, где стояла бы
        # настоящая полоска с теми датами, а клиент календарной арифметики не
        # повторяет.
        baseline_ends = [
            end_date(t.baseline_start, t.baseline_duration, calendar)
            if t.baseline_start is not None and t.baseline_duration is not None
            else None
            for t in tasks
        ]
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
        # План: утверждён ли и какой версией. По этим двум значениям интерфейс
        # отличает черновик (правки свободны) от утверждённого плана и знает,
        # какую кнопку показать — «Утвердить» или «Переутвердить».
        "plan_approved_at": (
            project.plan_approved_at.isoformat() if project.plan_approved_at else None
        ),
        "plan_version": project.plan_version,
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
                # Базовый план едет с задачей всегда, а не по отдельному
                # запросу: под каждой полоской рисуется его призрак, и второй
                # поход к серверу ради него означал бы диаграмму, которая
                # дорисовывается через кадр после появления.
                #
                # Пустые baseline_* при утверждённом плане — это и есть
                # признак «сверх первоначального плана»: отдельного флага нет,
                # потому что он был бы вычислим из этих же двух полей и однажды
                # разошёлся бы с ними.
                "baseline_start": t.baseline_start.isoformat() if t.baseline_start else None,
                "baseline_duration": t.baseline_duration,
                "baseline_end": baseline_end.isoformat() if baseline_end else None,
                **({"internal_note": t.internal_note} if show_notes else {}),
            }
            for t, task_end, baseline_end in zip(tasks, ends, baseline_ends)
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
    user: User = Depends(current_user),
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
    project, membership = _load_project(db, user, project_id)
    _require_project_read(membership)

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
            "op": visible_op(revision.op, role),
        }
        for revision in revisions
    ]


@router.post("/{project_id}/plan/approvals", status_code=201)
def approve_plan_route(
    project_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    """Утверждение плана, оно же переутверждение.

    Один маршрут, а не два: действие ровно одно — снять снимок и обновить
    базовые значения, — а различие в том, кому оно позволено. Второй маршрут
    отличался бы от первого только проверкой права, и разъехались бы они на
    первой же правке снимка.
    """
    project, membership = _load_project(db, user, project_id)
    role = parse_role(membership.role)

    first_time = project.plan_version == 0
    needed = Action.PLAN_APPROVE if first_time else Action.PLAN_REAPPROVE
    if not can(role, needed):
        raise HTTPException(status_code=403, detail="forbidden")

    version = approve_plan(db, project, actor_id=user.id)
    return {
        "version": version.version,
        "approved_at": version.approved_at.isoformat(),
        "tasks": len(version.snapshot),
    }


@router.get("/{project_id}/plan/approvals")
def list_plan_versions(
    project_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    """Летопись утверждений: что обещали в январе, что в марте.

    Снимок отдаётся целиком — в нём нет внутренних заметок, только даты,
    длительности и названия, а названия видит всякий, кто вправе читать
    проект.
    """
    project, membership = _load_project(db, user, project_id)
    _require_project_read(membership)

    versions = plan_versions(db, project)
    approvers = {
        row.id: row.name
        for row in db.scalars(
            select(User).where(User.id.in_({v.approved_by for v in versions if v.approved_by}))
        ).all()
    }
    return [
        {
            "version": version.version,
            "approved_at": version.approved_at.isoformat(),
            "approved_by": (
                {"id": str(version.approved_by), "name": approvers[version.approved_by]}
                if version.approved_by in approvers
                else None
            ),
            "snapshot": version.snapshot,
        }
        for version in versions
    ]


@router.post("/{project_id}/mutations", status_code=201)
def apply_mutation(
    project_id: uuid.UUID,
    op: PublicOp = Body(..., embed=True),
    reason: str | None = Body(default=None),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    project, membership = _load_project(db, user, project_id)
    if not can(parse_role(membership.role), Action.PROJECT_WRITE):
        raise HTTPException(status_code=403, detail="forbidden")

    try:
        revision = apply_op(db, project, to_internal(op), actor_id=user.id, reason=reason)
    except NotFoundInProject as error:
        # Сущность чужого проекта — не ошибка формата запроса: 404 тем же
        # принципом, что и в _load_project.
        raise HTTPException(status_code=404, detail=error.code)
    except ReasonRequired as error:
        # 409, а не 422: тело запроса верно, отказ снимается тем же запросом с
        # добавленной причиной. Числа едут в заголовках, потому что `detail`
        # обязан остаться машинным кодом — его переводит клиент, и подмешивать
        # в него числа значило бы заставить клиент разбирать строку.
        raise HTTPException(
            status_code=409,
            detail=error.code,
            headers={
                "X-Shift-Deviation-Days": str(error.deviation_days),
                "X-Shift-Threshold-Days": str(error.threshold_days),
            },
        )
    except InvalidOperation as error:
        raise HTTPException(status_code=422, detail=error.code)

    role = parse_role(membership.role)
    return {
        "seq": revision.seq,
        "op": visible_op(revision.op, role),
        "inverse": visible_op(revision.inverse, role),
    }
