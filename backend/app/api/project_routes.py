import secrets
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can
from app.auth import current_user
from app.calendar import end_date
from app.db import get_db
from app.models import Category, Membership, Organization, Project, Role, Task, User
from app.mutations import Op, apply_op
from app.settings_resolution import project_calendar
from app.text import slugify

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectOut(BaseModel):
    id: str
    name: str
    slug: str


def _membership(db: DbSession, user: User) -> Membership:
    membership = db.scalar(select(Membership).where(Membership.user_id == user.id))
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


def _unique_slug(db: DbSession, org_id: uuid.UUID, name: str) -> str:
    base = slugify(name)
    taken = db.scalar(
        select(Project).where(Project.org_id == org_id, Project.slug == base)
    )
    return base if taken is None else f"{base}-{secrets.token_hex(3)}"


def _require_project_read(membership: Membership) -> None:
    """Единственное место, где решается право на чтение: спрашивает access,
    не сравнивает роль напрямую. Отказ — 404, а не 403, тем же принципом,
    что и в _load_project: клиент без выданного доступа к проекту не должен
    отличить существующий проект от несуществующего."""
    if not can(Role(membership.role), Action.PROJECT_READ):
        raise HTTPException(status_code=404, detail="project_not_found")


def _visible_op(payload: dict, *, show_notes: bool) -> dict:
    """internal_note — единственное поле с ограниченной видимостью.
    create_task/delete_task кладут его в op/inverse наравне с остальными
    полями; здесь оно вычищается для тех, кому access отказывает в
    Action.READ_INTERNAL_NOTE. Возвращает новый словарь — revision.op /
    revision.inverse на самой записи не трогаются, иначе будущий undo
    восстановил бы задачу без заметки."""
    if show_notes or "internal_note" not in payload:
        return payload
    return {key: value for key, value in payload.items() if key != "internal_note"}


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    membership = _membership(db, user)
    if not can(Role(membership.role), Action.PROJECT_WRITE):
        raise HTTPException(status_code=403, detail="forbidden")

    project = Project(
        org_id=membership.org_id,
        name=payload.name,
        slug=_unique_slug(db, membership.org_id, payload.name),
    )
    db.add(project)
    db.flush()
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
    show_notes = can(Role(membership.role), Action.READ_INTERNAL_NOTE)

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

    return {
        "id": str(project.id),
        "name": project.name,
        "slug": project.slug,
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
                "end_date": end_date(t.start_date, t.duration_days, calendar).isoformat(),
                "criticality": t.criticality,
                "progress_pct": t.progress_pct,
                "position": t.position,
                **({"internal_note": t.internal_note} if show_notes else {}),
            }
            for t in tasks
        ],
    }


@router.post("/{project_id}/mutations", status_code=201)
def apply_mutation(
    project_id: uuid.UUID,
    op: Op = Body(..., embed=True),
    reason: str | None = Body(default=None),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    project, membership = _load_project(db, user, project_id)
    if not can(Role(membership.role), Action.PROJECT_WRITE):
        raise HTTPException(status_code=403, detail="forbidden")

    try:
        revision = apply_op(db, project, op, actor_id=user.id, reason=reason)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))

    show_notes = can(Role(membership.role), Action.READ_INTERNAL_NOTE)
    return {
        "seq": revision.seq,
        "op": _visible_op(revision.op, show_notes=show_notes),
        "inverse": _visible_op(revision.inverse, show_notes=show_notes),
    }
