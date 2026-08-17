"""Организация, в которой человек находится прямо сейчас.

До появления приглашений вопроса не было: членство было ровно одно, и любой
маршрут брал первое попавшееся. Приглашение делает второе членство обычным
делом — и «в какой организации выполняется этот запрос» становится настоящим
вопросом, у которого должен быть один ответ на всё приложение.
"""

import uuid

from fastapi import Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session as DbSession

from app.auth import current_session
from app.db import get_db
from app.models import Membership, Organization, Project, ProjectAccess, Role, Session


def memberships_of(db: DbSession, user_id: uuid.UUID) -> list[tuple[Membership, Organization]]:
    """Все организации человека, в устойчивом порядке.

    Порядок — по названию, а не по времени вступления: список показывается
    в переключателе, и человек ищет в нём знакомое слово, а не вспоминает,
    когда его куда позвали.
    """
    return list(
        db.execute(
            select(Membership, Organization)
            .join(Organization, Organization.id == Membership.org_id)
            .where(Membership.user_id == user_id)
            .order_by(Organization.name, Organization.id)
        ).all()
    )


def active_membership(db: DbSession, session: Session) -> Membership | None:
    """Членство, от имени которого выполняется запрос этой сессии.

    Выбранная организация может оказаться недоступной — человека вывели из
    неё, пока вкладка была открыта. Это не повод отвечать отказом: запрос
    выполняется от первого доступного членства, и человек видит организацию,
    в которой он всё ещё состоит, вместо экрана ошибки.
    """
    if session.active_org_id is not None:
        chosen = db.scalar(
            select(Membership).where(
                Membership.user_id == session.user_id,
                Membership.org_id == session.active_org_id,
            )
        )
        if chosen is not None:
            return chosen

    # Порядок задан явно, чтобы «первая» была одной и той же от запроса к
    # запросу, а не той, что первой вернул планировщик.
    return db.scalar(
        select(Membership)
        .where(Membership.user_id == session.user_id)
        .order_by(Membership.id)
    )


def switch(db: DbSession, session: Session, org_id: uuid.UUID) -> Membership | None:
    """Переключает сессию на другую организацию. None — человек в ней не состоит.

    Выбор живёт до конца сессии, а не до конца страницы: человек, работающий
    в чужой организации, не должен возвращаться в свою при каждой перезагрузке.
    """
    membership = db.scalar(
        select(Membership).where(
            Membership.user_id == session.user_id, Membership.org_id == org_id
        )
    )
    if membership is None:
        return None
    session.active_org_id = org_id
    db.flush()
    return membership


def current_membership(
    session: Session = Depends(current_session), db: DbSession = Depends(get_db)
) -> Membership:
    """Зависимость маршрутов: членство вместо пользователя.

    Маршруты спрашивают именно членство, потому что ровно от него зависят и
    видимость данных (организация), и права (роль); `user_id` в нём тоже есть.
    Отдельный вопрос «кто это» остаётся только там, где нужны имя или адрес.
    """
    membership = active_membership(db, session)
    if membership is None:
        raise HTTPException(status_code=403, detail="no_organization")
    return membership


# ---- состав: роли и вывод из организации ----------------------------------


class LastOwner(Exception):
    """Организация осталась бы без владельца, а починить это было бы некому.

    Владелец — единственная роль, которая правит настройки, зовёт людей и
    раздаёт роли. Организация, потерявшая последнего, не разжалована, а
    заперта навсегда: назначить нового владельца в ней больше нечем. Отсюда
    отказ, а не предупреждение, — и отсюда же то, что он одинаков для
    разжалования, вывода чужими руками и ухода своими.
    """


def owner_count(db: DbSession, org_id: uuid.UUID) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(Membership.org_id == org_id, Membership.role == Role.OWNER.value)
    )


def is_last_owner(db: DbSession, membership: Membership) -> bool:
    """Держится ли организация на этом человеке одном."""
    return membership.role == Role.OWNER.value and owner_count(db, membership.org_id) == 1


def member_of(db: DbSession, *, org_id: uuid.UUID, user_id: uuid.UUID) -> Membership | None:
    return db.scalar(
        select(Membership).where(Membership.org_id == org_id, Membership.user_id == user_id)
    )


def set_role(db: DbSession, membership: Membership, role: Role) -> None:
    """Меняет роль участника. Последнего владельца разжаловать нельзя.

    Назначение владельцем живёт именно здесь, а не в приглашении: приглашение
    без адреса достаётся предъявителю, и владельцем становился бы любой, кто
    открыл переславшуюся ссылку (см. NOT_INVITABLE в app.invitations). Здесь
    же адресат назван поимённо — это действующий участник, которого зовущий
    видит в списке.
    """
    if role is not Role.OWNER and is_last_owner(db, membership):
        raise LastOwner()
    membership.role = role.value
    db.flush()


def remove_membership(db: DbSession, membership: Membership) -> None:
    """Выводит человека из организации. Последнего владельца — нельзя.

    Поимённые доступы к проектам этой организации уходят вместе с членством:
    без них они означали бы «позвали обратно — и он снова видит всё, что
    видел», причём молча. Назначения на задачи, наоборот, остаются: снять их
    можно и с ушедшего (см. UnassignUser в app.mutations), а тихо стереть
    исполнителя со всех его задач значит переписать план в ответ на кадровое
    решение.

    Выбранная организация в сессиях ушедшего сбрасывается: без этого его
    сессия продолжала бы указывать на организацию, в которую он больше не
    входит. Отказом это не оборачивается — active_membership всё равно берёт
    первую доступную, — но указатель на чужое место лучше убрать сразу.
    """
    if is_last_owner(db, membership):
        raise LastOwner()

    org_projects = select(Project.id).where(Project.org_id == membership.org_id)
    db.execute(
        delete(ProjectAccess).where(
            ProjectAccess.user_id == membership.user_id,
            ProjectAccess.project_id.in_(org_projects),
        )
    )
    db.execute(
        update(Session)
        .where(
            Session.user_id == membership.user_id,
            Session.active_org_id == membership.org_id,
        )
        .values(active_org_id=None)
    )
    db.delete(membership)
    db.flush()
