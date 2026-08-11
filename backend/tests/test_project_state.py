from datetime import date

import pytest

from app.models import Category, Organization, Project, Task
from app.project_state import build_state


@pytest.fixture
def filled(db):
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    project = Project(org_id=org.id, name="Redesign", slug="redesign")
    db.add(project)
    db.flush()
    category = Category(project_id=project.id, name="Дизайн", color="#3b82f6", position=0)
    db.add(category)
    db.flush()
    task = Task(
        project_id=project.id,
        category_id=category.id,
        name="Логотип",
        internal_note="клиент платит с задержкой",
        start_date=date(2026, 3, 4),
        duration_days=5,
    )
    db.add(task)
    db.flush()
    return project, org


def test_state_carries_the_note_when_the_reader_may_see_it(db, filled):
    project, org = filled
    state = build_state(db, project, org, show_notes=True, show_assignees=True)

    assert state["tasks"][0]["internal_note"] == "клиент платит с задержкой"
    assert "assignee_ids" in state["tasks"][0]
    assert state["tasks"][0]["end_date"] == "2026-03-10"


def test_state_for_a_guest_carries_neither_notes_nor_assignees(db, filled):
    """Заметка не выходит наружу никогда, а исполнители — это состав
    организации, которого гость не видит и в остальных маршрутах."""
    project, org = filled
    state = build_state(db, project, org, show_notes=False, show_assignees=False)

    assert "internal_note" not in state["tasks"][0]
    assert "assignee_ids" not in state["tasks"][0]
    # Всё остальное на месте: гость видит ту же раскладку, а не огрызок.
    assert state["tasks"][0]["name"] == "Логотип"
    assert state["calendar"]["working_days"] > 0
    assert state["project_end"] == "2026-03-10"
