import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, parse_role
from app.auth import current_session
from app.db import get_db
from app.models import Membership, Organization, Session, User
from app.orgs import current_membership, memberships_of, switch

router = APIRouter(prefix="/api/org", tags=["org"])


class MemberOut(BaseModel):
    id: str
    name: str
    email: str
    role: str


class OrganizationOut(BaseModel):
    id: str
    name: str
    slug: str
    #: Роль спрашивающего в этой организации, а не свойство самой организации:
    #: интерфейс всё равно спросит её следующим запросом, чтобы решить, что
    #: показывать, и второй поход к серверу ради одного слова ничего не даёт.
    role: str


class SwitchIn(BaseModel):
    org_id: uuid.UUID


def _to_out(org: Organization, role: str) -> OrganizationOut:
    return OrganizationOut(id=str(org.id), name=org.name, slug=org.slug, role=role)


@router.get("", response_model=OrganizationOut)
def current_organization(
    membership: Membership = Depends(current_membership), db: DbSession = Depends(get_db)
):
    """Организация, в которой человек находится прямо сейчас.

    Права здесь не проверяются: название своей организации видит любой её
    участник, включая роль `client`. Скрывать его не от кого — оно подписывает
    каждый экран, на который человек и так имеет право войти.
    """
    return _to_out(db.get(Organization, membership.org_id), membership.role)


@router.get("/list", response_model=list[OrganizationOut])
def list_organizations(
    session: Session = Depends(current_session), db: DbSession = Depends(get_db)
):
    """Организации, в которых человек состоит, — содержимое переключателя.

    Список отдаётся и тогда, когда организация одна: решать, показывать ли
    переключатель, — дело интерфейса, а не сервера, и ветка «а если одна»,
    заведённая здесь, повторилась бы в каждом клиенте.
    """
    return [_to_out(org, membership.role) for membership, org in memberships_of(db, session.user_id)]


@router.post("/switch", response_model=OrganizationOut)
def switch_organization(
    payload: SwitchIn,
    session: Session = Depends(current_session),
    db: DbSession = Depends(get_db),
):
    """Переключает сессию на другую организацию.

    Чужая организация неотличима от несуществующей: 404, а не 403 — иначе
    перебор по адресу превращается в способ выяснить, какие организации в
    установке вообще есть.
    """
    membership = switch(db, session, payload.org_id)
    if membership is None:
        raise HTTPException(status_code=404, detail="organization_not_found")
    return _to_out(db.get(Organization, membership.org_id), membership.role)


@router.get("/members", response_model=list[MemberOut])
def list_members(
    membership: Membership = Depends(current_membership), db: DbSession = Depends(get_db)
):
    """Люди, которых можно назначить исполнителями.

    Отказ здесь — 403, а не 404, в отличие от маршрутов проекта: адрес не
    называет никакой сущности, существование которой стоило бы скрывать, а
    свою организацию спрашивающий и так видит. По спеку роль client состава
    организации не получает вовсе — и отсутствие у неё PROJECT_READ без
    выданного доступа к проекту ровно это и означает.
    """
    if not can(parse_role(membership.role), Action.PROJECT_READ):
        raise HTTPException(status_code=403, detail="forbidden")

    rows = db.execute(
        select(User, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.org_id == membership.org_id)
        .order_by(User.name, User.id)
    ).all()
    return [
        MemberOut(id=str(member.id), name=member.name, email=member.email, role=role)
        for member, role in rows
    ]
