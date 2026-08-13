"""Публичная ссылка на проект: выпуск, отзыв, разбор адреса.

Здесь же собирается сам адрес — из `PUBLIC_BASE_URL`, а не из заголовков
запроса. Заголовок `Host` подставляется тем, кто пришёл, и ссылка, собранная
из него, однажды уедет в письмо с чужим доменом; переменная окружения задана
тем, кто разворачивал, и одинакова для всех запросов.
"""

import secrets
from datetime import datetime, timezone
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.models import Organization, Project, ShareLink

# Публичный адрес: /p/<слаг организации>/<слаг проекта>. Токен идёт запросом,
# а не частью пути, и это разделение не косметическое. Путь — то, что человек
# читает и по чему узнаёт проект; токен — то, что делает отзыв ссылки
# осмысленным: без него «перевыпустить ссылку» не меняло бы адрес вовсе, и
# старая ссылка не умирала бы, а продолжала работать.
PUBLIC_PATH_PREFIX = "/p"
TOKEN_PARAM = "s"


class SharingDisabled(Exception):
    """Публичные ссылки запрещены — установкой или настройкой организации."""


def sharing_allowed(org: Organization) -> bool:
    """Разрешены ли публичные ссылки этой организации.

    Два рубильника, и порядок между ними односторонний: `PUBLIC_SHARING_ENABLED`
    выключает публикацию во всей установке, и никакая настройка организации
    его не перебивает. Закрытый контур — решение того, кто разворачивал.
    """
    return get_settings().public_sharing_enabled and org.public_sharing_enabled


def active_link(db: DbSession, project: Project) -> ShareLink | None:
    return db.scalar(
        select(ShareLink).where(
            ShareLink.project_id == project.id, ShareLink.revoked_at.is_(None)
        )
    )


class AlreadyShared(Exception):
    """У проекта уже есть живая ссылка — «создать» здесь не к чему."""


class NotShared(Exception):
    """Живой ссылки нет — «перевыпускать» нечего."""


def create_link(db: DbSession, project: Project, org: Organization) -> ShareLink:
    """Первый выпуск ссылки. Если ссылка уже есть — отказ, а не тихий перевыпуск.

    Разделение с rotate_link — про идемпотентность худшего случая: два клика
    по «Опубликовать» (или повтор запроса сетью) не должны молча убивать
    только что разосланный адрес. Убийство адреса — отдельное, явно названное
    действие.
    """
    if active_link(db, project) is not None:
        raise AlreadyShared
    return issue_link(db, project, org)


def rotate_link(db: DbSession, project: Project, org: Organization) -> ShareLink:
    """Перевыпуск: старый адрес умирает мгновенно, настройки переезжают."""
    if active_link(db, project) is None:
        raise NotShared
    return issue_link(db, project, org)


def issue_link(db: DbSession, project: Project, org: Organization) -> ShareLink:
    """Выпускает ссылку, убивая прежнюю.

    Общее тело create_link и rotate_link. Настройка комментариев переезжает
    на новую ссылку: человек выключил их сознательно, и перевыпуск адреса —
    не повод молча включить их обратно.
    """
    if not sharing_allowed(org):
        raise SharingDisabled

    previous = active_link(db, project)
    comments_enabled = (
        previous.comments_enabled if previous is not None else org.default_comments_enabled
    )
    if previous is not None:
        revoke_link(db, project)

    link = ShareLink(
        project_id=project.id,
        token=secrets.token_urlsafe(32),
        comments_enabled=comments_enabled,
    )
    db.add(link)
    db.flush()
    return link


def revoke_link(db: DbSession, project: Project) -> ShareLink | None:
    """Гасит действующую ссылку. Запись остаётся: адрес обязан отвечать
    «ссылка больше не действует», а не «такого проекта нет»."""
    link = active_link(db, project)
    if link is None:
        return None
    link.revoked_at = datetime.now(timezone.utc)
    db.flush()
    return link


def set_comments_enabled(db: DbSession, project: Project, enabled: bool) -> ShareLink | None:
    link = active_link(db, project)
    if link is None:
        return None
    link.comments_enabled = enabled
    db.flush()
    return link


def resolve(
    db: DbSession, *, org_slug: str, project_slug: str, token: str
) -> tuple[Organization, Project, ShareLink] | None:
    """Проект по публичному адресу и токену.

    Совпасть обязано всё сразу: слаги называют проект, токен доказывает, что
    адрес выдан владельцем. Токен, подошедший к другому проекту, не открывает
    этот — иначе одной действующей ссылки хватало бы, чтобы читать любой
    проект установки, подставляя чужие слаги.

    Отдельного ответа «слаг есть, а токен не тот» нет и не будет: он
    превращает адрес без токена в способ проверять, существует ли проект.
    """
    if not token:
        return None

    row = db.execute(
        select(Organization, Project, ShareLink)
        .join(Project, Project.org_id == Organization.id)
        .join(ShareLink, ShareLink.project_id == Project.id)
        .where(
            Organization.slug == org_slug,
            Project.slug == project_slug,
            ShareLink.token == token,
            ShareLink.revoked_at.is_(None),
        )
    ).first()
    if row is None:
        return None

    org, project, link = row
    # Рубильник действует и на уже выданные ссылки: организация, выключившая
    # публикацию, ожидает, что розданные адреса перестали открываться, а не
    # что закрылся только выпуск новых.
    if not sharing_allowed(org):
        return None
    return org, project, link


def public_url(org: Organization, project: Project, link: ShareLink) -> str:
    base = get_settings().public_base_url.rstrip("/")
    path = f"{PUBLIC_PATH_PREFIX}/{quote(org.slug)}/{quote(project.slug)}"
    return f"{base}{path}?{TOKEN_PARAM}={quote(link.token)}"
