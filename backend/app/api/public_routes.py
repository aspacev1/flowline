from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can
from app.comments import (
    MAX_COMMENT_LEN,
    CommentRefused,
    add_comment,
    author_names,
    comment_out,
    list_comments,
)
from app.config import get_settings
from app.db import get_db
from app.project_state import build_state
from app.rate_limit import RateLimiter
from app.sharing import NotPublished, resolve

# Ни один маршрут этого файла не зависит от current_user, и это его причина
# существовать отдельно от project_routes: там каждый маршрут начинается с
# загрузки проекта по сессии, и публичный маршрут по соседству однажды получил
# бы Depends(current_user) по недосмотру — то есть перестал бы быть публичным.
router = APIRouter(prefix="/api/public", tags=["public"])

# Потолок — из настройки, окно — час: «10 реплик» без указания, за какой срок,
# ничего не ограничивает. Счётчик живёт в модуле, а не в запросе: созданный
# заново на каждый запрос, он всегда пуст.
_guest_limiter = RateLimiter(
    limit=get_settings().guest_comment_rate_limit, window_seconds=3600
)


class GuestCommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_COMMENT_LEN)
    guest_name: str = Field(min_length=1, max_length=100)


def _open_project(db: DbSession, org_slug: str, project_slug: str):
    """Проект, открытый по этому адресу, или 404.

    Отказ один на все случаи — нет организации, нет проекта, ссылка отозвана:
    так решает `resolve`, и маршрут эту неразличимость не нарушает.
    """
    try:
        return resolve(db, org_slug, project_slug)
    except NotPublished as error:
        raise HTTPException(status_code=404, detail=error.code)


@router.get("/{org_slug}/{project_slug}")
def public_project(org_slug: str, project_slug: str, db: DbSession = Depends(get_db)):
    """Проект глазами гостя: та же раскладка, без заметок и исполнителей."""
    project, org, link = _open_project(db, org_slug, project_slug)

    state = build_state(db, project, org, show_notes=False, show_assignees=False)
    # Открыты ли комментарии — часть состояния страницы, а не отдельный
    # запрос: иначе форма реплики успевает мелькнуть до того, как выяснится,
    # что она запрещена.
    state["comments_enabled"] = link.comments_enabled
    return state


@router.get("/{org_slug}/{project_slug}/comments")
def public_comments(org_slug: str, project_slug: str, db: DbSession = Depends(get_db)):
    """Обсуждение проекта целиком: та же ветка, что видят участники.

    Ветка отдельной задачи наружу не отдаётся — карточки задачи на публичной
    странице нет, и отдавать ленту, которую негде показать, значит расширять
    поверхность без повода. Поэтому `task_id` здесь не параметр: реплики к
    задачам не попадают в этот ответ вовсе.
    """
    project, _org, _link = _open_project(db, org_slug, project_slug)

    comments = list_comments(db, project)
    actors = author_names(db, comments)
    return [comment_out(comment, actors) for comment in comments]


@router.post("/{org_slug}/{project_slug}/comments", status_code=201)
def add_public_comment(
    org_slug: str,
    project_slug: str,
    payload: GuestCommentIn,
    request: Request,
    db: DbSession = Depends(get_db),
):
    """Реплика гостя — человека без аккаунта, пришедшего по ссылке."""
    project, _org, link = _open_project(db, org_slug, project_slug)

    if not link.comments_enabled:
        raise HTTPException(status_code=403, detail="comments_disabled")
    # Роль гостя — None, а выданным доступом служит сама действующая ссылка:
    # ровно тот случай, ради которого в access.py заведён project_granted.
    if not can(None, Action.COMMENT, project_granted=True):
        raise HTTPException(status_code=403, detail="forbidden")

    # Адрес берётся из соединения, а не из X-Forwarded-For: заголовок
    # подделывается одной строкой, и ограничитель, верящий ему, не ограничивает
    # никого. За обратным прокси это адрес прокси — то есть общий потолок на
    # всех гостей разом; чинится списком доверенных прокси, а не доверием к
    # заголовку.
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

    # Словарь имён пуст: у реплики гостя автора-участника нет по определению.
    return comment_out(comment, {})
