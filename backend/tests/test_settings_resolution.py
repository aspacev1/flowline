from datetime import date

from app.calendar import WEEKDAYS_MON_FRI
from app.models import Organization, Project
from app.settings_resolution import (
    project_calendar,
    resolve_shift_threshold,
    resolve_working_days,
)

SUN_TO_THU = (1 << 6) | (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3)


def _org(**kwargs) -> Organization:
    org = Organization(name="Acme", slug="acme", **kwargs)
    org.default_locale = kwargs.get("default_locale", "az")
    org.working_days = kwargs.get("working_days", WEEKDAYS_MON_FRI)
    org.default_shift_threshold_days = kwargs.get("default_shift_threshold_days", 2)
    org.holiday_calendar = kwargs.get("holiday_calendar", [])
    return org


def _project(**kwargs) -> Project:
    project = Project(name="Redesign", slug="redesign")
    project.working_days = kwargs.get("working_days")
    project.shift_threshold_days = kwargs.get("shift_threshold_days")
    project.holidays_extra = kwargs.get("holidays_extra", [])
    project.workdays_extra = kwargs.get("workdays_extra", [])
    return project


def test_null_on_the_project_means_inherit():
    org = _org(working_days=SUN_TO_THU, default_shift_threshold_days=5)
    project = _project()

    assert resolve_working_days(project, org) == SUN_TO_THU
    assert resolve_shift_threshold(project, org) == 5


def test_explicit_value_on_the_project_wins():
    org = _org(working_days=SUN_TO_THU, default_shift_threshold_days=5)
    project = _project(working_days=WEEKDAYS_MON_FRI, shift_threshold_days=1)

    assert resolve_working_days(project, org) == WEEKDAYS_MON_FRI
    assert resolve_shift_threshold(project, org) == 1


def test_changing_the_org_default_reaches_inheriting_projects_only():
    org = _org(default_shift_threshold_days=2)
    inheriting = _project()
    overriding = _project(shift_threshold_days=7)

    org.default_shift_threshold_days = 10

    assert resolve_shift_threshold(inheriting, org) == 10
    assert resolve_shift_threshold(overriding, org) == 7


def test_calendar_layers_org_holidays_then_project_extras():
    org = _org(holiday_calendar=["2026-03-20"])
    project = _project(holidays_extra=["2026-03-21"], workdays_extra=["2026-03-07"])

    cal = project_calendar(project, org)

    assert cal.is_working(date(2026, 3, 20)) is False  # праздник организации
    assert cal.is_working(date(2026, 3, 21)) is False  # доп. выходной проекта
    assert cal.is_working(date(2026, 3, 7)) is True    # рабочая суббота проекта
    assert cal.is_working(date(2026, 3, 19)) is True   # обычный четверг
