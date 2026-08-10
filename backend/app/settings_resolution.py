import logging
from datetime import date

from app.calendar import Calendar
from app.models import Organization, Project

logger = logging.getLogger(__name__)


def _dates(raw: list[str] | None) -> frozenset[date]:
    """Даты из JSON-списка; непригодные записи пропускаются.

    Список приходит из базы, а не из тела запроса, и содержимое там могло
    оказаться каким угодно — от правки руками до старой версии формата.
    date.fromisoformat на одной такой строке поднимал исключение, и проект
    переставал читаться навсегда, без способа это исправить через
    приложение. Потерять один день календаря — меньшее зло, чем потерять
    проект; в журнале это видно.
    """
    parsed: set[date] = set()
    for item in raw or []:
        try:
            parsed.add(date.fromisoformat(item))
        except (TypeError, ValueError):
            logger.warning("непригодная дата в календаре пропущена: %r", item)
    return frozenset(parsed)


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
