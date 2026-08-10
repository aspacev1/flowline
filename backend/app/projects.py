import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.models import Project
from app.slugs import insert_with_unique_slug


def _slug_taken(db: DbSession, org_id: uuid.UUID, slug: str) -> bool:
    return (
        db.scalar(select(Project.id).where(Project.org_id == org_id, Project.slug == slug))
        is not None
    )


def create_project(db: DbSession, *, org_id: uuid.UUID, name: str) -> Project:
    """Создание проекта как действие домена, а не как сборка сущности в
    HTTP-слое. Слаг уникален в пределах организации, и уникальность держит
    ограничение в базе, а не проверка перед вставкой: два одновременных
    создания с одинаковым названием раньше давали пятисотку."""
    return insert_with_unique_slug(
        db,
        lambda slug: Project(org_id=org_id, name=name, slug=slug),
        name=name,
        is_taken=lambda slug: _slug_taken(db, org_id, slug),
    )
