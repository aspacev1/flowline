from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.project_state import build_state
from app.sharing import NotPublished, resolve

# Ни один маршрут этого файла не зависит от current_user, и это его причина
# существовать отдельно от project_routes: там каждый маршрут начинается с
# загрузки проекта по сессии, и публичный маршрут по соседству однажды получил
# бы Depends(current_user) по недосмотру — то есть перестал бы быть публичным.
router = APIRouter(prefix="/api/public", tags=["public"])


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
