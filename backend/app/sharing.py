from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.models import Organization, Project, ShareLink


class SharingRefused(Exception):
    """Отказ опубликовать или изменить публикацию.

    Той же формы, что MutationError и CommentRefused: машинный код наружу,
    человеческий текст — в журнал.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class NotPublished(SharingRefused):
    """По этому адресу ничего не открыто.

    Один класс на три разных случая — нет такой организации, нет такого
    проекта, ссылка отозвана — сознательно: разные ответы позволили бы
    перебором выяснить, какие организации и проекты существуют.
    """


def public_path(org: Organization, project: Project) -> str:
    """Адрес публичной страницы.

    Собирается здесь, а не в браузере: слаги нормализует сервер (см. text.py),
    и второй сборщик адреса в клиенте однажды разойдётся с этим — получится
    ссылка, которая не открывается.

    Префикс `/p/` не украшение: без него `/{организация}/{проект}` перехватил
    бы и собственные адреса приложения, и организация со слагом `login`
    заслонила бы вход.
    """
    return f"/p/{org.slug}/{project.slug}"


def link_of(db: DbSession, project: Project) -> ShareLink | None:
    """Действующая ссылка проекта. Отозванная — это отсутствие ссылки."""
    link = db.scalar(select(ShareLink).where(ShareLink.project_id == project.id))
    if link is None or link.revoked_at is not None:
        return None
    return link


def publish(db: DbSession, project: Project, org: Organization) -> ShareLink:
    """Открыть проект наружу.

    Повторная публикация оживляет прежний ряд, а не создаёт новый: ряд — это
    журнал публикаций проекта, и второй ряд означал бы второй адрес, которого
    у слагов быть не может.
    """
    if not org.public_sharing_enabled:
        raise SharingRefused("public_sharing_disabled", "организация запретила публичные ссылки")

    link = db.scalar(select(ShareLink).where(ShareLink.project_id == project.id))
    if link is None:
        # Умолчание организации применяется один раз, при первой публикации:
        # дальше переключателем распоряжается владелец проекта, и повторная
        # публикация не должна отменять его решение.
        link = ShareLink(project_id=project.id, comments_enabled=org.default_comments_enabled)
        db.add(link)
    else:
        link.revoked_at = None
    db.flush()
    return link


def revoke(db: DbSession, project: Project) -> None:
    """Закрыть адрес. Мгновенно: следующий запрос по нему уже не откроется."""
    link = db.scalar(select(ShareLink).where(ShareLink.project_id == project.id))
    if link is not None and link.revoked_at is None:
        link.revoked_at = datetime.now(timezone.utc)
        db.flush()


def set_comments_enabled(db: DbSession, project: Project, enabled: bool) -> ShareLink:
    link = link_of(db, project)
    if link is None:
        raise SharingRefused("not_published", "проект не опубликован")
    link.comments_enabled = enabled
    db.flush()
    return link


def resolve(
    db: DbSession, org_slug: str, project_slug: str
) -> tuple[Project, Organization, ShareLink]:
    """Проект, открытый по этому адресу, — или отказ.

    Единственное место, где решается, открыт ли проект наружу. Условий три —
    организация не запретила публикацию, ссылка есть, ссылка не отозвана, — и
    разнести их по маршрутам значило бы однажды проверить два из трёх.
    """
    row = db.execute(
        select(Project, Organization, ShareLink)
        .join(Organization, Organization.id == Project.org_id)
        .join(ShareLink, ShareLink.project_id == Project.id)
        .where(
            Organization.slug == org_slug,
            Project.slug == project_slug,
            ShareLink.revoked_at.is_(None),
            Organization.public_sharing_enabled.is_(True),
        )
    ).first()
    if row is None:
        raise NotPublished("project_not_found", "по этому адресу ничего не открыто")
    return row[0], row[1], row[2]
