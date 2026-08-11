import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.models import Project
from app.slugs import insert_with_unique_slug
from app.text import slugify


class SlugRefused(Exception):
    """Отказ принять слаг. Машинный код наружу, человеческий текст — в журнал."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


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


def free_slug(
    db: DbSession,
    org_id: uuid.UUID,
    raw: str,
    *,
    except_id: uuid.UUID | None = None,
) -> tuple[bool, str]:
    """Свободен ли слаг и что предложить, если занят.

    Свой собственный слаг проекта занятым не считается: иначе форма настроек
    ругалась бы на значение, которое в ней уже стоит.

    Нормализует сервер той же slugify, что и при создании: человек вводит
    «Редизайн 2026», получает `redizayn-2026`. Повторять транслитерацию в
    браузере нельзя — расхождение даст ссылку, которая не открывается.
    """
    slug = slugify(raw, fallback="")
    if not slug:
        raise SlugRefused("slug_empty", "слаг пуст после нормализации")

    taken = db.scalar(
        select(Project.id).where(
            Project.org_id == org_id, Project.slug == slug, Project.id != except_id
        )
    )
    if taken is None:
        return True, slug
    # Тот же приём, что и при создании: суффикс, а не отказ без вариантов.
    # Коллизия слага — не вина того, кто пришёл вторым.
    return False, f"{slug}-{secrets.token_hex(3)}"


def rename_slug(db: DbSession, project: Project, raw: str) -> Project:
    """Переименование слага.

    При адресе, собранном из слагов, это единственный настоящий перевыпуск
    публичной ссылки: прежний адрес после него мёртв, новый работает.
    """
    available, slug = free_slug(db, project.org_id, raw, except_id=project.id)
    if not available:
        raise SlugRefused("slug_taken", "слаг занят")
    project.slug = slug
    db.flush()
    return project
