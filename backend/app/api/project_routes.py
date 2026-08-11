import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, needs_project_grant, parse_role, visible_op
from app.api.deps import ProjectContext, membership_dependency, project_context
from app.api.serialization import comments_out, project_state
from app.auth import current_user
from app.calendar import CalendarError
from app.comments import CommentRejected, add_comment, list_comments
from app.db import get_db
from app.models import Membership, Project, ProjectAccess, Revision, User
from app.mutations import InvalidOperation, NotFoundInProject, PublicOp, apply_op, to_internal
from app.projects import create_project as create_project_entity

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
    membership: Membership = Depends(membership_dependency),
    db: DbSession = Depends(get_db),
):
    if not can(parse_role(membership.role), Action.PROJECT_WRITE):
        raise HTTPException(status_code=403, detail="forbidden")

    project = create_project_entity(db, org_id=membership.org_id, name=payload.name)
    return ProjectOut(id=str(project.id), name=project.name, slug=project.slug)


@router.get("", response_model=list[ProjectOut])
def list_projects(
    user: User = Depends(current_user),
    membership: Membership = Depends(membership_dependency),
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
        )
    except CalendarError as error:
        # Той же формы, что и отказы мутаций: 422 с машинным кодом. Раньше
        # здесь была голая пятисотка — вырожденную маску задаёт человек, и
        # проект переставал читаться без объяснения.
        raise HTTPException(status_code=422, detail=error.code)


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
            "op": visible_op(revision.op, context.role, project_granted=context.granted),
        }
        for revision in revisions
    ]


@router.post("/{project_id}/mutations", status_code=201)
def apply_mutation(
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
    except NotFoundInProject as error:
        # Сущность чужого проекта — не ошибка формата запроса: 404 тем же
        # принципом, что и в project_context.
        raise HTTPException(status_code=404, detail=error.code)
    except InvalidOperation as error:
        raise HTTPException(status_code=422, detail=error.code)

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
