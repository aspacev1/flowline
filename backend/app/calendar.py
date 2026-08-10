from dataclasses import dataclass, field
from datetime import date, timedelta

MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY = (1 << i for i in range(7))
WEEKDAYS_MON_FRI = MONDAY | TUESDAY | WEDNESDAY | THURSDAY | FRIDAY

_MAX_SEARCH_DAYS = 3650


@dataclass(frozen=True)
class Calendar:
    """Рабочий календарь проекта.

    Порядок применения: маска дней недели, затем праздники их убирают,
    затем extra_workdays возвращают обратно конкретные даты.
    """

    working_days: int = WEEKDAYS_MON_FRI
    holidays: frozenset[date] = field(default_factory=frozenset)
    extra_workdays: frozenset[date] = field(default_factory=frozenset)

    def is_working(self, d: date) -> bool:
        if d in self.extra_workdays:
            return True
        if d in self.holidays:
            return False
        return bool(self.working_days & (1 << d.weekday()))


def _first_working_on_or_after(start: date, cal: Calendar) -> date:
    d = start
    for _ in range(_MAX_SEARCH_DAYS):
        if cal.is_working(d):
            return d
        d += timedelta(days=1)
    raise ValueError("календарь не содержит ни одного рабочего дня")


def end_date(start: date, duration_days: int, cal: Calendar) -> date:
    """Дата окончания задачи. Стартовый рабочий день входит в длительность."""
    if duration_days < 1:
        raise ValueError("длительность должна быть не меньше одного дня")

    d = _first_working_on_or_after(start, cal)
    counted = 1
    while counted < duration_days:
        d += timedelta(days=1)
        if cal.is_working(d):
            counted += 1
    return d


def count_working_days(start: date, end: date, cal: Calendar) -> int:
    """Сколько рабочих дней в отрезке, включая обе границы."""
    if end < start:
        raise ValueError("конец отрезка раньше начала")

    total = 0
    d = start
    while d <= end:
        if cal.is_working(d):
            total += 1
        d += timedelta(days=1)
    return total
