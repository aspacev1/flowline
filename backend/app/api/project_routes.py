import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, parse_role, visible_op
from app.auth import current_user
from app.comments import (
    MAX_COMMENT_LEN,
    CommentRefused,
    TaskNotInProject,
    add_comment,
    list_comments,
)
from app.config import get_settings
from app.db import get_db
from app.models import Comment, Membership, Organization, Project, Revision, ShareLink, User
from app.mutations import InvalidOperation, NotFoundInProject, PublicOp, apply_op, to_internal
from app.project_state import build_state
from app.projects import SlugRefused, free_slug, rename_slug
from app.projects import create_project as create_project_entity
from app.sharing import (
    SharingRefused,
    public_path,
    publish,
    revoke,
    set_comments_enabled,
    stored_link,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectOut(BaseModel):
    id: str
    name: str
    slug: str


class ShareIn(BaseModel):
    published: bool
    comments_enabled: bool


class SlugIn(BaseModel):
    slug: str = Field(min_length=1, max_length=100)


def _share_out(link: ShareLink | None) -> dict:
    """Состояние публикации по ряду, включая отозванный.

    Отозванная ссылка помнит положение переключателя комментариев, и показать
    его иначе значило бы потерять решение владельца у него на глазах: снял
    публикацию — переключатель прыгнул сам собой.
    """
    return {
        "published": link is not None and link.revoked_at is None,
        "comments_enabled": link.comments_enabled if link else True,
    }


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_COMMENT_LEN)
    # null и отсутствие ключа — одно и то же: реплика к проекту целиком.
    task_id: uuid.UUID | None = None


def _comment_out(comment: Comment, actors: dict[uuid.UUID, str]) -> dict:
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

    return build_state(
        db,
        project,
        org,
        show_notes=can(parse_role(membership.role), Action.READ_INTERNAL_NOTE),
        show_assignees=True,
    )


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
        "share": _share_out(stored_link(db, project)),
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

    return _share_out(stored_link(db, project))


@router.get("/{project_id}/slug-check")
def check_slug(
    project_id: uuid.UUID,
    slug: str = Query(min_length=1, max_length=100),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Свободен ли слаг — и что предложить, если занят.

    Отдельный маршрут, а не только отказ на сохранении: спецификация обещает
    подсказку прямо в поле ввода, то есть до отправки формы.
    """
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
    except InvalidOperation as error:
        raise HTTPException(status_code=422, detail=error.code)

    role = parse_role(membership.role)
    return {
        "seq": revision.seq,
        "op": visible_op(revision.op, role),
        "inverse": visible_op(revision.inverse, role),
    }


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
    # Один запрос на всю ветку, а не по запросу на реплику: тот же довод, что
    # и у авторов ревизий.
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
        comment = add_comment(db, project, body=payload.body, task_id=payload.task_id, author=user)
    except TaskNotInProject as error:
        raise HTTPException(status_code=404, detail=error.code)
    except CommentRefused as error:
        raise HTTPException(status_code=422, detail=error.code)

    return _comment_out(comment, {user.id: user.name})
