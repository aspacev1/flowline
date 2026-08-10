import pytest

from app.access import Action, can, require
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
