import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
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
    ProjectAccess,
    Revision,
    Task,
    TaskAssignee,
    User,
)
from app.mutations import (
    MutationError,
    NotFoundInProject,
    PublicOp,
    ReasonRequired,
    apply_op,
    last_undoable,
    to_internal,
    undo,
    undo_batch,
)
from app.plans import approve_plan, plan_versions
from app.projects import create_project as create_project_entity
from app.settings_input import NULLABLE_PROJECT_FIELDS, ProjectSettingsIn, changes
from app.settings_resolution import project_calendar, resolve_shift_threshold, resolve_timezone
from app.slugs import slug_check

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


def _granted(db: DbSession, user: User, project_id: uuid.UUID) -> bool:
    """Позвали ли этого человека именно в этот проект.

    Спрашивается только ради роли `client`: остальные видят все проекты
    организации, и строка доступа для них ничего не значит. Но спрашивается
    всегда — ветка «если роль client» здесь означала бы, что правило живёт в
    двух местах: в матрице прав и в условии перед ней.
    """
    return (
        db.scalar(
            select(ProjectAccess.id).where(
                ProjectAccess.project_id == project_id, ProjectAccess.user_id == user.id
            )
        )
        is not None
    )


def _load_project(db: DbSession, user: User, project_id: uuid.UUID) -> tuple[Project, Membership]:
    membership = _membership(db, user)
    project = db.get(Project, project_id)
    # чужой проект неотличим от несуществующего: 404, а не 403
    if project is None or project.org_id != membership.org_id:
        raise HTTPException(status_code=404, detail="project_not_found")
    return project, membership


def _require_project_read(membership: Membership, *, granted: bool = False) -> None:
    """Единственное место, где решается право на чтение: спрашивает access,
    не сравнивает роль напрямую. Отказ — 404, а не 403, тем же принципом,
    что и в _load_project: клиент без выданного доступа к проекту не должен
    отличить существующий проект от несуществующего."""
    if not can(parse_role(membership.role), Action.PROJECT_READ, project_granted=granted):
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
    role = parse_role(membership.role)
    query = select(Project).where(Project.org_id == membership.org_id)

    if not can(role, Action.PROJECT_READ):
        # Роль без общего права чтения видит не пустой список, а только те
        # проекты, куда её позвали явно. Пустой список тем, у кого доступов
        # нет, — это то же самое, но сказанное данными, а не отказом: клиент
        # не должен узнавать о существовании остальных проектов.
        query = query.where(
            Project.id.in_(
                select(ProjectAccess.project_id).where(ProjectAccess.user_id == user.id)
            )
        )
        if not can(role, Action.PROJECT_READ, project_granted=True):
            raise HTTPException(status_code=404, detail="project_not_found")

    projects = db.scalars(query).all()
    return [ProjectOut(id=str(p.id), name=p.name, slug=p.slug) for p in projects]


@router.get("/{project_id}")
def get_project(
    project_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    project, membership = _load_project(db, user, project_id)
    granted = _granted(db, user, project.id)
    _require_project_read(membership, granted=granted)
    return project_state(db, project, role=parse_role(membership.role), granted=granted)


def project_state(db: DbSession, project: Project, *, role, granted: bool = False) -> dict:
    """Состояние проекта в том виде, в каком его вправе увидеть эта роль.

    Одна функция и для участника, и для гостя по публичной ссылке: страница
    по ссылке показывает ту же раскладку, что и рабочий экран, и собирать её
    вторым куском кода значило бы получить два проекта, расходящихся на первой
    же правке. Гость приходит сюда с `role=None` — той самой ролью, которую
    матрица прав знает как «гость».
    """
    org = db.get(Organization, project.org_id)
    calendar = project_calendar(project, org)
    # Заметка — единственное поле с ограниченной видимостью. Выданный доступ к
    # проекту её не открывает: клиент, позванный в проект, читает его, но не
    # внутренние заметки команды. Гость — тем более.
    show_notes = can(role, Action.READ_INTERNAL_NOTE, project_granted=granted)

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
        # То, что отменит кнопка «Отменить», — вместе с состоянием, а не
        # отдельным запросом: кнопка обязана быть неактивной сразу, а не
        # оживать через кадр после отрисовки. Запись проходит через
        # visible_op: снимок удалённой задачи несёт внутреннюю заметку, и
        # подпись кнопки не должна её выдать.
        "undoable": (
            {
                "seq": undoable.seq,
                "op": visible_op(undoable.op, role, project_granted=granted),
                "batch_id": str(undoable.batch_id) if undoable.batch_id else None,
            }
            if can(role, Action.PROJECT_WRITE, project_granted=granted)
            and (undoable := last_undoable(db, project)) is not None
            else None
        ),
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
        # Сырые переопределения — рядом с разрешёнными значениями, но отдельно
        # от них. Экрану настроек нужно именно это различие: `null` там
        # означает «наследовать», и показать его как унаследованное число
        # значило бы предложить человеку переопределить то, что он и не
        # переопределял.
        "overrides": {
            "timezone": project.timezone,
            "working_days": project.working_days,
            "shift_threshold_days": project.shift_threshold_days,
            "holidays_extra": list(project.holidays_extra or []),
            "workdays_extra": list(project.workdays_extra or []),
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


def _project_slug_taken(db: DbSession, org_id: uuid.UUID, slug: str, *, except_id) -> bool:
    return (
        db.scalar(
            select(Project.id).where(
                Project.org_id == org_id, Project.slug == slug, Project.id != except_id
            )
        )
        is not None
    )


@router.get("/{project_id}/slug-check")
def check_project_slug(
    project_id: uuid.UUID,
    slug: str = Query(min_length=1, max_length=100),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Свободен ли слаг внутри этой организации — и что предложить, если занят."""
    project, membership = _load_project(db, user, project_id)
    if not can(parse_role(membership.role), Action.PROJECT_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")

    def taken(candidate: str) -> bool:
        return _project_slug_taken(db, project.org_id, candidate, except_id=project.id)

    return slug_check(slug, is_taken=taken)


@router.patch("/{project_id}")
def update_project(
    project_id: uuid.UUID,
    payload: ProjectSettingsIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Уровень 3 настроек: слаг, целевая дата и переопределения организации.

    `null` в часовом поясе, рабочих днях и пороге — это «наследовать», а не
    «пусто», и отличается он от «поле не прислали» тем, что второе просто не
    попадает в набор изменений. Без этой разницы сбросить переопределение было
    бы нечем: любой запрос без поля стирал бы его.

    Правки не проходят через журнал ревизий: журнал — история плана, а не
    история настроек. Смешать их значило бы наполнить историю задачи записями
    о том, что кто-то поменял часовой пояс.
    """
    project, membership = _load_project(db, user, project_id)
    if not can(parse_role(membership.role), Action.PROJECT_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")

    updates = changes(payload, nullable=NULLABLE_PROJECT_FIELDS)
    if "slug" in updates and _project_slug_taken(
        db, project.org_id, updates["slug"], except_id=project.id
    ):
        raise HTTPException(status_code=409, detail="slug_taken")

    for field, value in updates.items():
        setattr(project, field, value)

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="slug_taken")

    return get_project(project_id, user, db)


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
    granted = _granted(db, user, project.id)
    _require_project_read(membership, granted=granted)

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


def _refuse(error: MutationError):
    """Отказ мутации → отказ HTTP. Форма одна на все маршруты, которые пишут.

    Три разных статуса не по вкусу, а по смыслу: чужая сущность неотличима от
    несуществующей (404), непроизнесённая причина снимается тем же запросом с
    добавленным полем (409), а неверно составленная операция не пройдёт
    никогда (422).
    """
    if isinstance(error, NotFoundInProject):
        return HTTPException(status_code=404, detail=error.code)
    if isinstance(error, ReasonRequired):
        return HTTPException(
            status_code=409,
            detail=error.code,
            headers={
                "X-Shift-Deviation-Days": str(error.deviation_days),
                "X-Shift-Threshold-Days": str(error.threshold_days),
            },
        )
    return HTTPException(status_code=422, detail=error.code)


@router.post("/{project_id}/undo", status_code=201)
def undo_last(
    project_id: uuid.UUID,
    reason: str | None = Body(default=None, embed=True),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Отмена последнего изменения.

    Номер ревизии в адресе не принимается сознательно: спецификация обещает
    отмену последнего действия, а произвольная ревизия из середины журнала —
    это другая функция («вернуть вот это одно»), и её обратная операция
    построена для того состояния, которого уже нет.

    Причина принимается, потому что отмена проходит ту же проверку порога, что
    и всякое изменение сроков: возврат, уводящий задачу от базового плана
    дальше порога, объясняется ровно так же.
    """
    project, membership = _load_project(db, user, project_id)
    if not can(parse_role(membership.role), Action.PROJECT_WRITE):
        raise HTTPException(status_code=403, detail="forbidden")

    revision = last_undoable(db, project)
    if revision is None:
        raise HTTPException(status_code=404, detail="nothing_to_undo")

    try:
        applied = undo(db, project, revision, actor_id=user.id, reason=reason)
    except MutationError as error:
        raise _refuse(error)

    role = parse_role(membership.role)
    return {"seq": applied.seq, "undone_seq": revision.seq, "op": visible_op(applied.op, role)}


@router.post("/{project_id}/batches/{batch_id}/undo", status_code=201)
def undo_whole_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Откат пачки целиком — одной кнопкой, как обещано про применение AI."""
    project, membership = _load_project(db, user, project_id)
    if not can(parse_role(membership.role), Action.PROJECT_WRITE):
        raise HTTPException(status_code=403, detail="forbidden")

    try:
        applied = undo_batch(db, project, batch_id, actor_id=user.id)
    except MutationError as error:
        raise _refuse(error)

    return {"undone": len(applied), "seq": applied[-1].seq}


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
    _require_project_read(membership, granted=_granted(db, user, project.id))

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
    except MutationError as error:
        raise _refuse(error)

    role = parse_role(membership.role)
    return {
        "seq": revision.seq,
        "op": visible_op(revision.op, role),
        "inverse": visible_op(revision.inverse, role),
    }
