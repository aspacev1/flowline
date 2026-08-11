"""Публичный доступ: ссылка на проект и комментарии — свои и гостевые.

Гость аккаунта не имеет: его роль — `None`, ровно та, которую матрица прав
знает как «гость по ссылке». Никакой второй матрицы для него не заводится.
"""

import secrets
import time
import uuid
from collections import deque
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, parse_role
from app.api.project_routes import _granted, _load_project, project_state
from app.auth import current_user
from app.config import get_settings
from app.db import get_db
from app.models import Comment, Organization, Project, ShareLink, Task, User

router = APIRouter(prefix="/api", tags=["public"])


class ShareOut(BaseModel):
    url: str
    comments_enabled: bool
    created_at: str


class ShareIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    comments_enabled: bool | None = None


def _public_url(project: Project, org: Organization, link: ShareLink) -> str:
    """Адрес вида flowline.ru/p/acme/redesign-2026?s=…

    Слаги организации и проекта — ради читаемости, токен — ради возможности
    ссылку отозвать. Без токена «перевыпустить ссылку: старая умирает
    мгновенно» неисполнимо: адрес из двух слагов после перевыпуска остался бы
    тем же самым и продолжал работать.
    """
    base = get_settings().public_base_url.rstrip("/")
    return f"{base}/p/{org.slug}/{project.slug}?s={link.token}"


def _active_link(db: DbSession, project: Project) -> ShareLink | None:
    return db.scalar(
        select(ShareLink).where(
            ShareLink.project_id == project.id, ShareLink.revoked_at.is_(None)
        )
    )


def _require_admin(membership) -> None:
    if not can(parse_role(membership.role), Action.PROJECT_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")


@router.get("/projects/{project_id}/share", response_model=ShareOut | None)
def read_share(
    project_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    project, membership = _load_project(db, user, project_id)
    _require_admin(membership)
    link = _active_link(db, project)
    if link is None:
        return None
    org = db.get(Organization, project.org_id)
    return ShareOut(
        url=_public_url(project, org, link),
        comments_enabled=link.comments_enabled,
        created_at=link.created_at.isoformat(),
    )


@router.post("/projects/{project_id}/share", response_model=ShareOut, status_code=201)
def issue_share(
    project_id: uuid.UUID,
    payload: ShareIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Выпустить ссылку — или перевыпустить: прежняя умирает мгновенно.

    Глобальный запрет публичных ссылок (PUBLIC_SHARING_ENABLED) и запрет на
    уровне организации проверяются здесь оба: первый — решение того, кто
    разворачивает, второй — владельца, и ни один не должен обходиться другим.
    """
    project, membership = _load_project(db, user, project_id)
    _require_admin(membership)

    org = db.get(Organization, project.org_id)
    if not get_settings().public_sharing_enabled or not org.public_sharing_enabled:
        raise HTTPException(status_code=403, detail="public_sharing_disabled")

    previous = _active_link(db, project)
    if previous is not None:
        previous.revoked_at = datetime.now(timezone.utc)

    link = ShareLink(
        project_id=project.id,
        token=secrets.token_urlsafe(24),
        comments_enabled=(
            payload.comments_enabled
            if payload.comments_enabled is not None
            else org.default_comments_enabled
        ),
    )
    db.add(link)
    db.flush()
    return ShareOut(
        url=_public_url(project, org, link),
        comments_enabled=link.comments_enabled,
        created_at=link.created_at.isoformat(),
    )


@router.patch("/projects/{project_id}/share", response_model=ShareOut)
def update_share(
    project_id: uuid.UUID,
    payload: ShareIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Переключатель комментариев. Ссылку при этом не трогает: выключить
    комментарии — не то же самое, что разослать всем новый адрес."""
    project, membership = _load_project(db, user, project_id)
    _require_admin(membership)
    link = _active_link(db, project)
    if link is None:
        raise HTTPException(status_code=404, detail="share_not_found")
    if payload.comments_enabled is not None:
        link.comments_enabled = payload.comments_enabled
    db.flush()
    org = db.get(Organization, project.org_id)
    return ShareOut(
        url=_public_url(project, org, link),
        comments_enabled=link.comments_enabled,
        created_at=link.created_at.isoformat(),
    )


@router.delete("/projects/{project_id}/share", status_code=204)
def revoke_share(
    project_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    project, membership = _load_project(db, user, project_id)
    _require_admin(membership)
    link = _active_link(db, project)
    if link is None:
        raise HTTPException(status_code=404, detail="share_not_found")
    link.revoked_at = datetime.now(timezone.utc)
    db.flush()


# --- гостевая сторона --------------------------------------------------------


def _link_by_token(db: DbSession, token: str) -> ShareLink:
    link = db.scalar(select(ShareLink).where(ShareLink.token == token))
    # Отозванная ссылка неотличима от несуществующей: гостю всё равно, а
    # разница между ними — это подсказка тому, кто перебирает токены.
    if link is None or link.revoked_at is not None:
        raise HTTPException(status_code=404, detail="share_not_found")
    return link


@router.get("/public/{token}")
def public_project(token: str, db: DbSession = Depends(get_db)):
    """Проект по публичной ссылке.

    Та же раскладка, что и на рабочем экране, и та же функция сборки
    состояния — но с ролью гостя: без внутренних заметок и без отмены.
    """
    link = _link_by_token(db, token)
    project = db.get(Project, link.project_id)
    org = db.get(Organization, project.org_id)
    return {
        **project_state(db, project, role=None),
        "org_name": org.name,
        "comments_enabled": link.comments_enabled,
    }


class CommentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=4000)
    task_id: uuid.UUID | None = None
    #: Гость при первом комментарии вводит имя. Участнику это поле не нужно:
    #: его подписывает аккаунт.
    guest_name: str | None = Field(default=None, max_length=100)


class CommentOut(BaseModel):
    id: str
    task_id: str | None
    body: str
    created_at: str
    author_name: str
    #: Реплики гостя визуально отличаются от реплик участников с аккаунтом.
    is_guest: bool


def _serialize(db: DbSession, comments: list[Comment]) -> list[CommentOut]:
    authors = {
        row.id: row.name
        for row in db.scalars(
            select(User).where(
                User.id.in_({c.author_user_id for c in comments if c.author_user_id})
            )
        ).all()
    }
    return [
        CommentOut(
            id=str(comment.id),
            task_id=str(comment.task_id) if comment.task_id else None,
            body=comment.body,
            created_at=comment.created_at.isoformat(),
            author_name=authors.get(comment.author_user_id) or comment.guest_name or "",
            is_guest=comment.author_user_id is None,
        )
        for comment in comments
    ]


def _comments(db: DbSession, project: Project) -> list[Comment]:
    return list(
        db.scalars(
            select(Comment)
            .where(Comment.project_id == project.id)
            .order_by(Comment.created_at, Comment.id)
        ).all()
    )


def _check_task(db: DbSession, project: Project, task_id: uuid.UUID | None) -> None:
    if task_id is None:
        return
    task = db.get(Task, task_id)
    if task is None or task.project_id != project.id:
        raise HTTPException(status_code=404, detail="task_not_found")


# Гостевые комментарии по IP: без ограничителя публичная страница превращается
# в форму для спама, а модерации в первой версии нет. Счётчик в памяти
# процесса — того же рода, что и рассылка ревизий по WebSocket: пока сервер
# один, этого достаточно.
_GUEST_HITS: dict[str, deque[float]] = {}
_WINDOW_SECONDS = 3600


def _check_guest_rate(request: Request) -> None:
    limit = get_settings().guest_comment_rate_limit
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    hits = _GUEST_HITS.setdefault(ip, deque())
    while hits and now - hits[0] > _WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= limit:
        raise HTTPException(status_code=429, detail="comment_rate_limited")
    hits.append(now)


@router.get("/public/{token}/comments", response_model=list[CommentOut])
def public_comments(token: str, db: DbSession = Depends(get_db)):
    link = _link_by_token(db, token)
    project = db.get(Project, link.project_id)
    return _serialize(db, _comments(db, project))


@router.post("/public/{token}/comments", response_model=CommentOut, status_code=201)
def add_public_comment(
    token: str, payload: CommentIn, request: Request, db: DbSession = Depends(get_db)
):
    link = _link_by_token(db, token)
    if not link.comments_enabled:
        raise HTTPException(status_code=403, detail="comments_disabled")
    if not payload.guest_name or not payload.guest_name.strip():
        raise HTTPException(status_code=422, detail="guest_name_required")

    _check_guest_rate(request)
    project = db.get(Project, link.project_id)
    _check_task(db, project, payload.task_id)

    comment = Comment(
        project_id=project.id,
        task_id=payload.task_id,
        guest_name=payload.guest_name.strip(),
        body=payload.body,
    )
    db.add(comment)
    db.flush()
    return _serialize(db, [comment])[0]


# --- сторона участника -------------------------------------------------------


@router.get("/projects/{project_id}/comments", response_model=list[CommentOut])
def project_comments(
    project_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    project, membership = _load_project(db, user, project_id)
    granted = _granted(db, user, project.id)
    if not can(parse_role(membership.role), Action.PROJECT_READ, project_granted=granted):
        raise HTTPException(status_code=404, detail="project_not_found")
    return _serialize(db, _comments(db, project))


@router.post("/projects/{project_id}/comments", response_model=CommentOut, status_code=201)
def add_comment(
    project_id: uuid.UUID,
    payload: CommentIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Комментарий участника.

    Право комментировать есть у всех ролей, включая `client` с выданным
    доступом: спецификация даёт его каждому, кто вправе читать проект.
    """
    project, membership = _load_project(db, user, project_id)
    granted = _granted(db, user, project.id)
    if not can(parse_role(membership.role), Action.COMMENT, project_granted=granted):
        raise HTTPException(status_code=404, detail="project_not_found")
    _check_task(db, project, payload.task_id)

    comment = Comment(
        project_id=project.id,
        task_id=payload.task_id,
        author_user_id=user.id,
        body=payload.body,
    )
    db.add(comment)
    db.flush()
    return _serialize(db, [comment])[0]
