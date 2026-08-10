from enum import StrEnum

from app.models import Role


class Action(StrEnum):
    PROJECT_READ = "project_read"
    PROJECT_WRITE = "project_write"
    PROJECT_ADMIN = "project_admin"
    ORG_ADMIN = "org_admin"
    COMMENT = "comment"
    READ_INTERNAL_NOTE = "read_internal_note"


_MATRIX: dict[Role | None, frozenset[Action]] = {
    Role.OWNER: frozenset(Action),
    Role.EDITOR: frozenset(
        {
            Action.PROJECT_READ,
            Action.PROJECT_WRITE,
            Action.PROJECT_ADMIN,
            Action.COMMENT,
            Action.READ_INTERNAL_NOTE,
        }
    ),
    Role.VIEWER: frozenset(
        {Action.PROJECT_READ, Action.COMMENT, Action.READ_INTERNAL_NOTE}
    ),
    Role.CLIENT: frozenset({Action.PROJECT_READ, Action.COMMENT}),
    None: frozenset({Action.PROJECT_READ, Action.COMMENT}),
}

# Роли, которые видят только те проекты, куда их позвали явно.
_NEEDS_GRANT: frozenset[Role | None] = frozenset({Role.CLIENT, None})


def can(role: Role | None, action: Action, *, project_granted: bool = False) -> bool:
    if role in _NEEDS_GRANT and not project_granted:
        return False
    return action in _MATRIX.get(role, frozenset())


def require(role: Role | None, action: Action, *, project_granted: bool = False) -> None:
    if not can(role, action, project_granted=project_granted):
        raise PermissionError(f"{role or 'guest'} не может выполнить {action}")
