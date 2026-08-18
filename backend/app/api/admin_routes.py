"""Панель директора: кто зарегистрирован и когда пользовался продуктом в
последний раз.

Доступ решает не роль в организации — Role.OWNER имеет смысл только внутри
одной организации, а владельцев организаций в установке может быть сколько
угодно, — а роль директора (см. app.director). Это свойство самой установки:
директор не обязан состоять ни в одной из организаций, за которыми наблюдает.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.auth import current_user
from app.db import get_db
from app.director import is_director
from app.models import Membership, Organization, User

router = APIRouter(prefix="/api/admin", tags=["admin"])


def current_director(user: User = Depends(current_user)) -> User:
    """Тот же человек, что и current_user, но допущенный в панель директора.

    Отказ — 403, а не 404: адрес не называет никакой чужой сущности,
    существование которой стоило бы скрывать. То, что панель вообще
    существует, для остальных прячет уже интерфейс, не показывающий пункт
    меню (см. UserOut.is_director в auth_routes.py).
    """
    if not is_director(user.email):
        raise HTTPException(status_code=403, detail="forbidden")
    return user


class AdminUserOut(BaseModel):
    id: str
    name: str
    email: str
    #: Дата регистрации — момент, когда завёлся аккаунт.
    created_at: str
    #: Последний раз, когда с сессией этого человека пришёл запрос. `null` —
    #: активности ещё не видно: аккаунт заведён (или обновлён миграцией), но
    #: обращения новее последнего шага обновления ещё не случилось
    #: (см. _LAST_USED_WRITE_STEP в app.auth).
    last_active_at: str | None
    #: Организации, в которых состоит человек, по имени. Пусто — вышел из
    #: всех, в том числе из собственной, заведённой при регистрации.
    organizations: list[str]


@router.get("/users", response_model=list[AdminUserOut])
def list_users(_: User = Depends(current_director), db: DbSession = Depends(get_db)):
    """Все аккаунты установки — самые новые регистрации первыми.

    Организации подтягиваются одним отдельным запросом и раскладываются по
    владельцу в памяти, а не join'ом к списку пользователей: join размножил
    бы строку человека на число его организаций и потребовал бы схлопывать
    дубликаты здесь же.
    """
    users = db.scalars(select(User).order_by(User.created_at.desc(), User.id)).all()

    org_rows = db.execute(
        select(Membership.user_id, Organization.name).join(
            Organization, Organization.id == Membership.org_id
        )
    ).all()
    orgs_by_user: dict[uuid.UUID, list[str]] = {}
    for user_id, org_name in org_rows:
        orgs_by_user.setdefault(user_id, []).append(org_name)

    return [
        AdminUserOut(
            id=str(person.id),
            name=person.name,
            email=person.email,
            created_at=person.created_at.isoformat(),
            last_active_at=(
                person.last_active_at.isoformat() if person.last_active_at else None
            ),
            organizations=sorted(orgs_by_user.get(person.id, [])),
        )
        for person in users
    ]
