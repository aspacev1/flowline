import uuid

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, needs_project_grant, parse_role, visible_op
from app.api.deps import ProjectContext, project_context
from app.api.serialization import comments_out, project_state
from app.auth import current_user
from app.calendar import CalendarError
from app.comments import CommentRejected, add_comment, list_comments
from app.db import get_db
from app.live import hub
from app.models import Membership, Project, ProjectAccess, Revision, User
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
from app.orgs import current_membership
from app.plans import approve_plan, plan_versions
from app.projects import create_project as create_project_entity
from app.settings_input import NULLABLE_PROJECT_FIELDS, ProjectSettingsIn, changes
from app.slugs import slug_check

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectOut(BaseModel):
    id: str
    name: str
    slug: str


class CommentIn(BaseModel):
    body: str = Field(min_length=1)
    task_id: uuid.UUID | None = None


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
    user: User = Depends(current_user),
    membership: Membership = Depends(current_membership),
    db: DbSession = Depends(get_db),
):
    role = parse_role(membership.role)
    if not can(role, Action.PROJECT_READ, project_granted=True):
        # Роль, которая не читает проекты ни при каком гранте (то есть
        # значение вне матрицы), не получает и списка. Тот же 404, что и у
        # отдельного проекта: пустой список сказал бы «проектов нет», а это
        # неправда.
        raise HTTPException(status_code=404, detail="project_not_found")

    query = select(Project).where(Project.org_id == membership.org_id)
    if needs_project_grant(role):
        # Роль, которую зовут в проекты поимённо, видит ровно их. Фильтр
        # запросом, а не отсевом в Python: список проектов организации — это
        # ровно то, что от неё скрывают.
        query = query.join(ProjectAccess, ProjectAccess.project_id == Project.id).where(
            ProjectAccess.user_id == user.id
        )
    projects = db.scalars(query).all()
    return [ProjectOut(id=str(p.id), name=p.name, slug=p.slug) for p in projects]


def _undoable(db: DbSession, context: ProjectContext) -> dict | None:
    """Запись, которую снимет кнопка «Отменить», — или None.

    Проходит через visible_op: снимок удалённой задачи несёт внутреннюю
    заметку, и подпись кнопки не должна её выдать.
    """
    if not context.can(Action.PROJECT_WRITE):
        return None
    revision = last_undoable(db, context.project)
    if revision is None:
        return None
    return {
        "seq": revision.seq,
        "op": visible_op(revision.op, context.role, project_granted=context.granted),
        "batch_id": str(revision.batch_id) if revision.batch_id else None,
    }


@router.get("/{project_id}")
def get_project(
    context: ProjectContext = Depends(project_context), db: DbSession = Depends(get_db)
):
    try:
        return project_state(
            db,
            context.project,
            context.org,
            show_notes=context.can(Action.READ_INTERNAL_NOTE),
            undoable=_undoable(db, context),
        )
    except CalendarError as error:
        # Той же формы, что и отказы мутаций: 422 с машинным кодом. Раньше
        # здесь была голая пятисотка — вырожденную маску задаёт человек, и
        # проект переставал читаться без объяснения.
        raise HTTPException(status_code=422, detail=error.code)


def _revision_entry(revision: Revision, actor_name: str | None, op: dict) -> dict:
    """Запись журнала в том виде, в каком её читает клиент.

    Одна форма на два пути: ленту истории запрашивают по HTTP, а новые ревизии
    приходят в сокет. Собранные порознь, они разойдутся на первом же добавленном
    поле, и клиенту придётся разбирать две формы одного события.

    `op` приходит параметром, а не берётся из ревизии: кому что видно, решается
    у получателя (в HTTP — по роли спрашивающего, в сокете — по роли каждого
    подписчика отдельно), и решать это здесь значило бы решать дважды.
    """
    return {
        "seq": revision.seq,
        "created_at": revision.created_at.isoformat(),
        # Автора может не быть: операции AI и системные записи идут без
        # человека, и выдумывать им автора нельзя.
        "actor": (
            {"id": str(revision.actor_user_id), "name": actor_name}
            if actor_name is not None
            else None
        ),
        # Причина — текст человека: отдаётся как есть и не переводится.
        "reason": revision.reason,
        "op": op,
    }


@router.get("/{project_id}/revisions")
def list_revisions(
    task_id: uuid.UUID | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    context: ProjectContext = Depends(project_context),
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
    query = select(Revision).where(Revision.project_id == context.project.id)
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

    return [
        _revision_entry(
            revision,
            actors.get(revision.actor_user_id),
            visible_op(revision.op, context.role, project_granted=context.granted),
        )
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
    slug: str = Query(min_length=1, max_length=100),
    context: ProjectContext = Depends(project_context),
    db: DbSession = Depends(get_db),
):
    """Свободен ли слаг внутри этой организации — и что предложить, если занят."""
    context.require(Action.PROJECT_ADMIN)

    def taken(candidate: str) -> bool:
        return _project_slug_taken(
            db, context.project.org_id, candidate, except_id=context.project.id
        )

    return slug_check(slug, is_taken=taken)


@router.patch("/{project_id}")
def update_project(
    payload: ProjectSettingsIn,
    context: ProjectContext = Depends(project_context),
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
    context.require(Action.PROJECT_ADMIN)
    project = context.project

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

    return get_project(context, db)


@router.post("/{project_id}/undo", status_code=201)
def undo_last(
    reason: str | None = Body(default=None, embed=True),
    context: ProjectContext = Depends(project_context),
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
    context.require(Action.PROJECT_WRITE)

    revision = last_undoable(db, context.project)
    if revision is None:
        raise HTTPException(status_code=404, detail="nothing_to_undo")

    try:
        applied = undo(db, context.project, revision, actor_id=context.user.id, reason=reason)
    except MutationError as error:
        raise _refuse(error)

    return {
        "seq": applied.seq,
        "undone_seq": revision.seq,
        "op": visible_op(applied.op, context.role, project_granted=context.granted),
    }


@router.post("/{project_id}/batches/{batch_id}/undo", status_code=201)
def undo_whole_batch(
    batch_id: uuid.UUID,
    context: ProjectContext = Depends(project_context),
    db: DbSession = Depends(get_db),
):
    """Откат пачки целиком — одной кнопкой, как обещано про применение AI."""
    context.require(Action.PROJECT_WRITE)

    try:
        applied = undo_batch(db, context.project, batch_id, actor_id=context.user.id)
    except MutationError as error:
        raise _refuse(error)

    return {"undone": len(applied), "seq": applied[-1].seq}


@router.post("/{project_id}/plan/approvals", status_code=201)
def approve_plan_route(
    context: ProjectContext = Depends(project_context), db: DbSession = Depends(get_db)
):
    """Утверждение плана, оно же переутверждение.

    Один маршрут, а не два: действие ровно одно — снять снимок и обновить
    базовые значения, — а различие в том, кому оно позволено. Второй маршрут
    отличался бы от первого только проверкой права, и разъехались бы они на
    первой же правке снимка.
    """
    first_time = context.project.plan_version == 0
    context.require(Action.PLAN_APPROVE if first_time else Action.PLAN_REAPPROVE)

    version = approve_plan(db, context.project, actor_id=context.user.id)
    return {
        "version": version.version,
        "approved_at": version.approved_at.isoformat(),
        "tasks": len(version.snapshot),
    }


@router.get("/{project_id}/plan/approvals")
def list_plan_versions(
    context: ProjectContext = Depends(project_context), db: DbSession = Depends(get_db)
):
    """Летопись утверждений: что обещали в январе, что в марте.

    Снимок отдаётся целиком — в нём нет внутренних заметок, только даты,
    длительности и названия, а названия видит всякий, кто вправе читать
    проект.
    """
    versions = plan_versions(db, context.project)
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
    background: BackgroundTasks,
    op: PublicOp = Body(..., embed=True),
    reason: str | None = Body(default=None),
    context: ProjectContext = Depends(project_context),
    db: DbSession = Depends(get_db),
):
    context.require(Action.PROJECT_WRITE)

    try:
        revision = apply_op(
            db, context.project, to_internal(op), actor_id=context.user.id, reason=reason
        )
    except MutationError as error:
        # Сущность чужого проекта — не ошибка формата запроса, а непроизнесённая
        # причина снимается тем же запросом с добавленным полем: разбор кодов
        # общий для всех пишущих маршрутов.
        raise _refuse(error)

    # Заметка внутрь события кладётся как есть: кому её видно, решает каждый
    # сокет отдельно — в одной комнате сидят и редактор, и клиент.
    event = {"type": "revision", **_revision_entry(revision, context.user.name, revision.op)}

    # Коммит явный, до постановки рассылки в очередь, и это не перестраховка.
    # Разослать можно только то, что уже лежит в базе: получив сигнал, клиент
    # перезапрашивает проект целиком — и, придя раньше коммита, не увидел бы
    # изменения, а второго сигнала не будет. Полагаться здесь на коммит из
    # get_db нельзя: фоновые задачи выполняются раньше, чем закрывается
    # зависимость с yield. Повторный коммит на выходе безвреден — коммитить
    # уже нечего.
    db.commit()
    background.add_task(hub.publish, context.project.id, event)

    seen = {"role": context.role, "project_granted": context.granted}
    return {
        "seq": revision.seq,
        "op": visible_op(revision.op, **seen),
        "inverse": visible_op(revision.inverse, **seen),
    }


@router.get("/{project_id}/comments")
def list_project_comments(
    task_id: uuid.UUID | None = None,
    context: ProjectContext = Depends(project_context),
    db: DbSession = Depends(get_db),
):
    """Лента проекта — та же самая, что видна на публичной странице.

    Гостевые реплики приходят участнику вместе с остальными: смысл публичной
    ссылки в том, чтобы разговор с клиентом жил в проекте, а не в почте.
    """
    return comments_out(db, list_comments(db, context.project, task_id=task_id))


@router.post("/{project_id}/comments", status_code=201)
def create_project_comment(
    payload: CommentIn,
    context: ProjectContext = Depends(project_context),
    db: DbSession = Depends(get_db),
):
    context.require(Action.COMMENT)
    try:
        comment = add_comment(
            db,
            context.project,
            body=payload.body,
            task_id=payload.task_id,
            author=context.user,
        )
    except CommentRejected as error:
        # task_not_found — не ошибка формата: та же 404, что и у мутаций,
        # ссылающихся на чужую задачу.
        status = 404 if error.code == "task_not_found" else 422
        raise HTTPException(status_code=status, detail=error.code)
    return comments_out(db, [comment])[0]
