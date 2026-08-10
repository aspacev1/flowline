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


# Значение роли, которого нет в Role. Не None: None — это гость по ссылке, у
# которого права есть. Незнакомая роль не должна получать вообще ничего.
UNKNOWN_ROLE = "__unknown__"


def parse_role(raw: str | None) -> Role | str | None:
    """Роль из записи членства в вид, понятный can().

    Role(raw) на испорченном значении поднимает ValueError — то есть пятисотку
    ещё до того, как спросят can(), и запертая по умолчанию матрица прав
    оказывается недостижимой. Незнакомое значение — это отказ, а не авария.
    """
    if raw is None:
        return None
    try:
        return Role(raw)
    except ValueError:
        return UNKNOWN_ROLE


def can(role: Role | None, action: Action, *, project_granted: bool = False) -> bool:
    if role in _NEEDS_GRANT and not project_granted:
        return False
    # .get с пустым множеством по умолчанию: незнакомая роль не находит себя в
    # матрице и не может ничего — матрица заперта по умолчанию.
    return action in _MATRIX.get(role, frozenset())


def require(role: Role | None, action: Action, *, project_granted: bool = False) -> None:
    if not can(role, action, project_granted=project_granted):
        raise PermissionError(f"{role or 'guest'} не может выполнить {action}")


# Поля журнала, показывать которые вправе не каждый. Сегодня оно ровно одно —
# спецификация обещает, что сложной видимости по полям не будет.
_NOTE_FIELD = "internal_note"


def visible_op(payload: dict, role: Role | None, *, project_granted: bool = False) -> dict:
    """Запись журнала в том виде, в каком её вправе увидеть эта роль.

    Решение о видимости живёт здесь, а не в маршруте: то же самое понадобится
    истории изменений на карточке задачи, и её автор не должен заново
    выяснять, какие операции несут заметку. create_task кладёт internal_note
    в op наравне с остальными полями, delete_task — в inverse (снимок для
    отмены).

    Возвращает новый словарь: revision.op / revision.inverse на самой записи
    не трогаются, иначе будущая отмена восстановила бы задачу без заметки.
    """
    if _NOTE_FIELD not in payload:
        return payload
    if can(role, Action.READ_INTERNAL_NOTE, project_granted=project_granted):
        return payload
    return {key: value for key, value in payload.items() if key != _NOTE_FIELD}
