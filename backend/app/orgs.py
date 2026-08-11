"""Организация, в которой человек находится прямо сейчас.

До появления приглашений вопроса не было: членство было ровно одно, и любой
маршрут брал первое попавшееся. Приглашение делает второе членство обычным
делом — и «в какой организации выполняется этот запрос» становится настоящим
вопросом, у которого должен быть один ответ на всё приложение.
"""

import uuid

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.auth import current_session
from app.db import get_db
from app.models import Membership, Organization, Session


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
