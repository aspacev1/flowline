import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.models import Membership, Project, User
from app.slugs import insert_with_unique_slug


def first_membership(db: DbSession, user: User) -> Membership | None:
    """Членство, от имени которого человек смотрит на мир.

    Человек может состоять в нескольких организациях; переключателя ещё нет, и
    берётся первая. Порядок задан явно, чтобы «первая» была хотя бы одной и той
    же от запроса к запросу, а не той, что первой вернул планировщик.
    """
    return db.scalar(select(Membership).where(Membership.user_id == user.id).order_by(Membership.id))


def project_in_scope(
    db: DbSession, membership: Membership, project_id: uuid.UUID
) -> Project | None:
    """Проект, если он принадлежит организации этого членства.

    `None` и на «нет такого проекта», и на «проект чужой» — сознательно одно
    значение: чужой проект обязан быть неотличим от несуществующего, и разница
    не должна доживать до вызывающего, который однажды переведёт её в разные
    ответы. Спрашивают отсюда и HTTP, и сокет, поэтому правило живёт в домене,
    а не в маршруте.
    """
    project = db.get(Project, project_id)
    if project is None or project.org_id != membership.org_id:
        return None
    return project


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
