from datetime import date

from app.calendar import Calendar
from app.models import Organization, Project


def _dates(raw: list[str] | None) -> frozenset[date]:
    return frozenset(date.fromisoformat(item) for item in (raw or []))


def resolve_working_days(project: Project, org: Organization) -> int:
    return project.working_days if project.working_days is not None else org.working_days


def resolve_timezone(project: Project, org: Organization) -> str:
    return project.timezone if project.timezone is not None else org.default_timezone


def resolve_shift_threshold(project: Project, org: Organization) -> int:
    if project.shift_threshold_days is not None:
        return project.shift_threshold_days
    return org.default_shift_threshold_days


def project_calendar(project: Project, org: Organization) -> Calendar:
    """Календарь проекта: маска недели, минус праздники организации и проекта,
    плюс явно объявленные рабочие дни проекта."""
    holidays = _dates(org.holiday_calendar) | _dates(project.holidays_extra)
    return Calendar(
        working_days=resolve_working_days(project, org),
        holidays=holidays,
        extra_workdays=_dates(project.workdays_extra),
    )
