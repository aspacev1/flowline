from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, parse_role
from app.api.deps import current_membership
from app.auth import current_user
from app.db import get_db
from app.models import Membership, Organization, User

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


@router.get("", response_model=OrganizationOut)
def current_organization(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Организация, в которой человек находится прямо сейчас.

    Права здесь не проверяются: название своей организации видит любой её
    участник, включая роль `client`. Скрывать его не от кого — оно подписывает
    каждый экран, на который человек и так имеет право войти.
    """
    membership = current_membership(db, user)
    org = db.get(Organization, membership.org_id)
    return OrganizationOut(id=str(org.id), name=org.name, slug=org.slug, role=membership.role)


@router.get("/members", response_model=list[MemberOut])
def list_members(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Люди, которых можно назначить исполнителями.

    Отказ здесь — 403, а не 404, в отличие от маршрутов проекта: адрес не
    называет никакой сущности, существование которой стоило бы скрывать, а
    свою организацию спрашивающий и так видит. По спеку роль client состава
    организации не получает вовсе — и отсутствие у неё PROJECT_READ без
    выданного доступа к проекту ровно это и означает.
    """
    membership = current_membership(db, user)
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
