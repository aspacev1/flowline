import pytest

from app.access import (
    UNKNOWN_ROLE,
    Action,
    can,
    needs_project_grant,
    parse_role,
    require,
    visible_op,
)
from app.models import Role


def test_owner_can_do_everything():
    for action in Action:
        assert can(Role.OWNER, action, project_granted=True) is True


def test_editor_writes_projects_but_does_not_administer_the_org():
    assert can(Role.EDITOR, Action.PROJECT_WRITE) is True
    assert can(Role.EDITOR, Action.PROJECT_READ) is True
    assert can(Role.EDITOR, Action.ORG_ADMIN) is False


def test_viewer_reads_and_comments_only():
    assert can(Role.VIEWER, Action.PROJECT_READ) is True
    assert can(Role.VIEWER, Action.COMMENT) is True
    assert can(Role.VIEWER, Action.PROJECT_WRITE) is False


def test_client_reads_only_granted_projects():
    assert can(Role.CLIENT, Action.PROJECT_READ, project_granted=True) is True
    assert can(Role.CLIENT, Action.PROJECT_READ, project_granted=False) is False


def test_client_and_guest_never_see_the_internal_note():
    assert can(Role.CLIENT, Action.READ_INTERNAL_NOTE, project_granted=True) is False
    assert can(None, Action.READ_INTERNAL_NOTE, project_granted=True) is False
    assert can(Role.VIEWER, Action.READ_INTERNAL_NOTE) is True


def test_guest_reads_the_shared_project_and_comments():
    assert can(None, Action.PROJECT_READ, project_granted=True) is True
    assert can(None, Action.COMMENT, project_granted=True) is True
    assert can(None, Action.PROJECT_WRITE, project_granted=True) is False


def test_require_raises_for_a_forbidden_action():
    with pytest.raises(PermissionError):
        require(Role.VIEWER, Action.PROJECT_WRITE)


def test_owner_succeeds_without_an_explicit_project_grant():
    # project_granted=False — это значение по умолчанию, и именно с ним
    # приходят маршруты: owner не входит в _NEEDS_GRANT и не должен зависеть
    # от гранта, который сегодня некому выдать.
    for action in Action:
        assert can(Role.OWNER, action) is True


def test_comment_is_refused_to_client_and_guest_without_a_project_grant():
    assert can(Role.CLIENT, Action.COMMENT, project_granted=False) is False
    assert can(None, Action.COMMENT, project_granted=False) is False


def test_an_unknown_role_gets_nothing():
    """Матрица заперта по умолчанию: значение, которого нет в Role, не даёт
    даже прав гостя — иначе испорченная запись членства превращалась бы в
    повышение до «гостя по ссылке»."""
    for action in Action:
        assert can(UNKNOWN_ROLE, action) is False
        assert can(UNKNOWN_ROLE, action, project_granted=True) is False


def test_parse_role_turns_a_broken_value_into_a_refusal_not_a_crash():
    # Role("шеф") поднимал ValueError — то есть пятисотку ещё до того, как
    # спросят can(), и запертая матрица оказывалась недостижимой через HTTP.
    assert parse_role("owner") is Role.OWNER
    assert parse_role(None) is None
    assert parse_role("шеф") == UNKNOWN_ROLE
    assert can(parse_role("шеф"), Action.PROJECT_READ, project_granted=True) is False


# ---- Видимость полей журнала ------------------------------------------------


def _create_task_op() -> dict:
    return {
        "type": "create_task",
        "task_id": "11111111-1111-1111-1111-111111111111",
        "name": "Logo",
        "internal_note": "тайный план",
    }


def test_visible_op_keeps_the_note_for_a_role_that_may_read_it():
    payload = _create_task_op()
    assert visible_op(payload, Role.EDITOR) == payload


def test_visible_op_strips_the_note_for_client_and_guest():
    payload = _create_task_op()

    for role in (Role.CLIENT, None):
        shown = visible_op(payload, role, project_granted=True)
        assert "internal_note" not in shown
        assert shown["name"] == "Logo"


def test_visible_op_does_not_mutate_the_stored_payload():
    # revision.op на самой записи трогать нельзя: будущая отмена восстановила
    # бы задачу без заметки.
    payload = _create_task_op()
    visible_op(payload, Role.CLIENT, project_granted=True)
    assert payload["internal_note"] == "тайный план"


def test_visible_op_passes_through_operations_without_a_note():
    payload = {"type": "delete_task", "task_id": "11111111-1111-1111-1111-111111111111"}
    assert visible_op(payload, Role.CLIENT, project_granted=True) is payload


def test_only_the_roles_that_are_invited_project_by_project_need_a_grant():
    """Список ролей, которым нужен явный доступ, спрашивают снаружи — список
    проектов отбирает по нему строки. Знание остаётся в access, но перестало
    быть приватным."""
    assert needs_project_grant(Role.CLIENT) is True
    assert needs_project_grant(None) is True
    assert needs_project_grant(Role.VIEWER) is False
    assert needs_project_grant(Role.OWNER) is False
