from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, parse_role
from app.auth import current_user
from app.db import get_db
from app.models import Membership, User

router = APIRouter(prefix="/api/org", tags=["org"])


class MemberOut(BaseModel):
    id: str
    name: str
    email: str
    role: str


@router.get("/members", response_model=list[MemberOut])
def list_members(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Люди, которых можно назначить исполнителями.

    Отказ здесь — 403, а не 404, в отличие от маршрутов проекта: адрес не
    называет никакой сущности, существование которой стоило бы скрывать, а
    свою организацию спрашивающий и так видит. По спеку роль client состава
    организации не получает вовсе — и отсутствие у неё PROJECT_READ без
    выданного доступа к проекту ровно это и означает.
    """
    # Та же «первая по порядку» организация, что и в маршрутах проекта:
    # переключателя между организациями ещё нет.
    membership = db.scalar(
        select(Membership).where(Membership.user_id == user.id).order_by(Membership.id)
    )
    if membership is None:
        raise HTTPException(status_code=403, detail="no_organization")
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
