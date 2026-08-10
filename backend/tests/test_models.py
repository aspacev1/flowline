from datetime import date

from app.calendar import WEEKDAYS_MON_FRI
from app.models import Category, Organization, Project, Task


def test_organization_defaults_come_from_the_spec(db):
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()

    assert org.default_locale == "az"
    assert org.working_days == WEEKDAYS_MON_FRI
    assert org.default_shift_threshold_days == 2
    assert org.holiday_calendar == []


def test_project_overrides_are_null_by_default(db):
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()

    project = Project(org_id=org.id, name="Redesign", slug="redesign")
    db.add(project)
    db.flush()

    # null означает «наследовать», а не «пусто» — копий значений организации быть не должно
    assert project.working_days is None
    assert project.shift_threshold_days is None
    assert project.timezone is None


def test_task_belongs_to_a_category_and_keeps_its_position(db):
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    project = Project(org_id=org.id, name="Redesign", slug="redesign")
    db.add(project)
    db.flush()
    category = Category(project_id=project.id, name="Design", color="#3b82f6", position=0)
    db.add(category)
    db.flush()

    task = Task(
        project_id=project.id,
        category_id=category.id,
        name="Logo",
        start_date=date(2026, 3, 4),
        duration_days=5,
        position=0,
    )
    db.add(task)
    db.flush()

    assert task.criticality == "normal"
    assert task.progress_pct == 0
    assert task.baseline_start is None
