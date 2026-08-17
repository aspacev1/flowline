"""Общие зависимости маршрутов: организация спрашивающего и контекст проекта.

Жили внутри `project_routes` до тех пор, пока маршрутов вокруг одного проекта
было немного. Их стало трое — состояние, ссылка, комментарии, — и копия
проверки «этот ли проект, есть ли право читать» в каждом файле разошлась бы
первой же правкой.
"""

import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, parse_role
from app.auth import current_user
from app.db import get_db
from app.models import Membership, Organization, Project, ProjectAccess, Role, User
from app.orgs import current_membership

# Членство берётся из app.orgs, а не ищется здесь: с приглашениями второе
# членство стало обычным делом, и «в какой организации выполняется запрос»
# решает выбор, живущий в сессии, — один ответ на всё приложение.
__all__ = ["ProjectContext", "current_membership", "project_context", "project_granted"]


def project_granted(db: DbSession, project_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Позвали ли этого человека именно в этот проект.

    Спрашивается для всех ролей, а не только для `client`: решение о том,
    какой роли грант нужен, принимает `access.py`, и маршрут, решающий это за
    него, был бы вторым местом, где живёт матрица прав.
    """
    return (
        db.scalar(
            select(ProjectAccess.id).where(
                ProjectAccess.project_id == project_id, ProjectAccess.user_id == user_id
            )
        )
        is not None
    )


@dataclass(frozen=True)
class ProjectContext:
    """Проект, его организация и права спрашивающего на него.

    Собирается один раз на запрос: без этого каждый маршрут заново достаёт
    членство, проект и организацию — три запроса, повторённых столько раз,
    сколько у проекта маршрутов.
    """

    user: User
    membership: Membership
    org: Organization
    project: Project
    granted: bool

    @property
    def role(self) -> Role | str | None:
        return parse_role(self.membership.role)

    @property
    def scoped(self) -> bool:
        return self.membership.project_scoped

    def can(self, action: Action) -> bool:
        return can(self.role, action, project_granted=self.granted, scoped=self.scoped)

    def require(self, action: Action) -> None:
        """Отказ — 403: адрес проекта спрашивающий уже прошёл, значит читать
        его он вправе, и скрывать существование проекта больше не от кого."""
        if not self.can(action):
            raise HTTPException(status_code=403, detail="forbidden")


def project_context(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    membership: Membership = Depends(current_membership),
    db: DbSession = Depends(get_db),
) -> ProjectContext:
    """Проект по адресу — вместе с правом его читать.

    Чужой проект, несуществующий проект и проект, к которому этого человека не
    звали, отвечают одинаково: 404. Разные ответы превратили бы адрес в способ
    перебирать чужие проекты — а роль `client` видит ровно те, куда её позвали,
    и знать о существовании остальных не должна.
    """
    project = db.get(Project, project_id)
    if project is None or project.org_id != membership.org_id:
        raise HTTPException(status_code=404, detail="project_not_found")

    context = ProjectContext(
        user=user,
        membership=membership,
        org=db.get(Organization, project.org_id),
        project=project,
        granted=project_granted(db, project.id, user.id),
    )
    if not context.can(Action.PROJECT_READ):
        raise HTTPException(status_code=404, detail="project_not_found")
    return context
