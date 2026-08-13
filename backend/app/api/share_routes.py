"""Управление публичной ссылкой проекта. Всё, что здесь есть, доступно тем,
кто вправе администрировать проект, — владельцу и редактору.

Отдельный файл, а не ещё четыре маршрута в `project_routes`: публикация
проекта наружу — самостоятельное решение с собственными рубильниками, и
смешивать её с чтением плана значит прятать её среди прочего.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.access import Action
from app.api.deps import ProjectContext, project_context
from app.db import get_db
from app.models import ShareLink
from app.sharing import (
    AlreadyShared,
    NotShared,
    SharingDisabled,
    active_link,
    create_link,
    public_url,
    revoke_link,
    rotate_link,
    set_comments_enabled,
    sharing_allowed,
)

router = APIRouter(prefix="/api/projects", tags=["sharing"])


class ShareOut(BaseModel):
    """Состояние публикации проекта.

    `allowed` отдаётся всегда, даже когда ссылки нет: интерфейс обязан
    отличать «ещё не опубликован» от «публикация запрещена установкой» —
    иначе кнопка «опубликовать» обещает действие, которое кончится отказом.
    """

    allowed: bool
    url: str | None
    comments_enabled: bool
    created_at: str | None


class CommentsIn(BaseModel):
    comments_enabled: bool


def _out(context: ProjectContext, link: ShareLink | None) -> ShareOut:
    allowed = sharing_allowed(context.org)
    if link is None:
        return ShareOut(
            allowed=allowed,
            url=None,
            # Пока ссылки нет, показывается то, что унаследует новая:
            # переключатель в интерфейсе не должен прыгать в момент выпуска.
            comments_enabled=context.org.default_comments_enabled,
            created_at=None,
        )
    return ShareOut(
        allowed=allowed,
        url=public_url(context.org, context.project, link),
        comments_enabled=link.comments_enabled,
        created_at=link.created_at.isoformat(),
    )


@router.get("/{project_id}/share", response_model=ShareOut)
def get_share(context: ProjectContext = Depends(project_context), db: DbSession = Depends(get_db)):
    context.require(Action.PROJECT_ADMIN)
    return _out(context, active_link(db, context.project))


@router.post("/{project_id}/share", response_model=ShareOut, status_code=201)
def issue_share(
    context: ProjectContext = Depends(project_context), db: DbSession = Depends(get_db)
):
    """Первый выпуск ссылки. Если она уже есть — 409, а не тихий перевыпуск:
    повтор запроса (двойной клик, ретрай сети) не должен убивать только что
    разосланный адрес. Перевыпуск — отдельный маршрут ниже."""
    context.require(Action.PROJECT_ADMIN)
    try:
        link = create_link(db, context.project, context.org)
    except SharingDisabled:
        raise HTTPException(status_code=403, detail="sharing_disabled")
    except AlreadyShared:
        raise HTTPException(status_code=409, detail="share_link_exists")
    return _out(context, link)


@router.post("/{project_id}/share/rotate", response_model=ShareOut, status_code=201)
def rotate_share(
    context: ProjectContext = Depends(project_context), db: DbSession = Depends(get_db)
):
    """Перевыпуск: прежний адрес умирает в тот же момент."""
    context.require(Action.PROJECT_ADMIN)
    try:
        link = rotate_link(db, context.project, context.org)
    except SharingDisabled:
        raise HTTPException(status_code=403, detail="sharing_disabled")
    except NotShared:
        raise HTTPException(status_code=404, detail="share_link_not_found")
    return _out(context, link)


@router.patch("/{project_id}/share", response_model=ShareOut)
def update_share(
    payload: CommentsIn,
    context: ProjectContext = Depends(project_context),
    db: DbSession = Depends(get_db),
):
    context.require(Action.PROJECT_ADMIN)
    link = set_comments_enabled(db, context.project, payload.comments_enabled)
    if link is None:
        raise HTTPException(status_code=404, detail="share_link_not_found")
    return _out(context, link)


@router.delete("/{project_id}/share", status_code=204)
def revoke_share(
    context: ProjectContext = Depends(project_context), db: DbSession = Depends(get_db)
):
    context.require(Action.PROJECT_ADMIN)
    revoke_link(db, context.project)
