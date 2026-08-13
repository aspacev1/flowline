from dataclasses import dataclass, field
from datetime import date, timedelta

MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY = (1 << i for i in range(7))
WEEKDAYS_MON_FRI = MONDAY | TUESDAY | WEDNESDAY | THURSDAY | FRIDAY

_MAX_SEARCH_DAYS = 3650


class CalendarError(ValueError):
    """Календарь настроен так, что дату посчитать нельзя.

    Отдельный класс, а не голый ValueError: маску рабочих дней задаёт
    человек, поэтому вырожденная настройка — это отказ, о котором надо
    сказать, а не авария сервера. Код машинный, по тем же правилам, что и у
    отказов мутаций: прозу читателю собирает клиент на его языке.

    Наследует ValueError, чтобы прежние ловушки на ValueError продолжали
    работать.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


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


def _next_day(d: date) -> date:
    """Следующий день или CalendarError у края поддерживаемых дат.

    date.max + день — это OverflowError, то есть авария сервера на задаче,
    поставленной на конец 9999 года. Край календаря — то же вырождение, что и
    «рабочих дней нет»: даты дальше просто не существует, и об этом надо
    сказать отказом, а не пятисоткой.
    """
    try:
        return d + timedelta(days=1)
    except OverflowError:
        raise CalendarError(
            "calendar_date_out_of_range",
            "дата вышла за край поддерживаемого календаря",
        ) from None


def _first_working_on_or_after(start: date, cal: Calendar) -> date:
    d = start
    for _ in range(_MAX_SEARCH_DAYS):
        if cal.is_working(d):
            return d
        d = _next_day(d)
    raise CalendarError(
        "calendar_has_no_working_days", "календарь не содержит ни одного рабочего дня"
    )


def first_working_on_or_after(start: date, cal: Calendar) -> date:
    """Первый рабочий день, начиная с указанного. Публичное имя внутреннего
    помощника: раскладка частей разбиения ищет старт следующей части."""
    return _first_working_on_or_after(start, cal)


def _week_workday_count(mask: int) -> int:
    return bin(mask & 0b1111111).count("1")


def _mask_days_between(start: date, end: date, mask: int) -> int:
    """Рабочие дни по одной только недельной маске, включая обе границы.

    Полные недели считаются умножением, и лишь остаток — до семи дней —
    перебором. Это то, что делает счёт арифметикой: до волны 4 каждый GET
    проекта шагал циклом по каждому дню каждой задачи.
    """
    days = (end - start).days + 1
    weeks, remainder = divmod(days, 7)
    total = weeks * _week_workday_count(mask)
    for offset in range(remainder):
        day = start + timedelta(days=weeks * 7 + offset)
        if mask & (1 << day.weekday()):
            total += 1
    return total


def count_working_days(start: date, end: date, cal: Calendar) -> int:
    """Сколько рабочих дней в отрезке, включая обе границы.

    Маска — арифметикой, исключения — поштучно: праздников и объявленных
    рабочих дней конечное число, и поправка на них не зависит от длины
    отрезка.
    """
    if end < start:
        raise ValueError("конец отрезка раньше начала")

    total = _mask_days_between(start, end, cal.working_days)
    for holiday in cal.holidays:
        if (
            start <= holiday <= end
            and cal.working_days & (1 << holiday.weekday())
            and holiday not in cal.extra_workdays
        ):
            total -= 1
    for extra in cal.extra_workdays:
        if start <= extra <= end and not (cal.working_days & (1 << extra.weekday())):
            total += 1
    return total


def end_date(start: date, duration_days: int, cal: Calendar) -> date:
    """Дата окончания задачи. Стартовый рабочий день входит в длительность.

    Двоичный поиск по count_working_days вместо шага по дням: каждая проверка
    — арифметика по маске плюс поштучные исключения, и стоимость не растёт с
    длительностью. Прежний цикл делал до 3650 шагов на задачу — на каждый GET
    проекта с сотней задач это сотни тысяч итераций.
    """
    if duration_days < 1:
        raise ValueError("длительность должна быть не меньше одного дня")

    first = _first_working_on_or_after(start, cal)

    if _week_workday_count(cal.working_days) == 0:
        # Вырожденный календарь: рабочие дни — только объявленные явно.
        ahead = sorted(day for day in cal.extra_workdays if day >= first)
        if len(ahead) < duration_days:
            raise CalendarError(
                "calendar_too_few_working_days",
                "календарь не содержит достаточного количества рабочих дней для такой длительности",
            )
        return ahead[duration_days - 1]

    # Верхняя граница поиска: недель хватает с запасом на все праздники
    # впереди; если не хватило — расширяем, пока не упёрлись в край дат или
    # в потолок поиска (те же пределы, что были у пошагового цикла).
    weeks = duration_days // _week_workday_count(cal.working_days) + 2
    try:
        high = first + timedelta(weeks=weeks)
    except OverflowError:
        high = date.max
    while count_working_days(first, high, cal) < duration_days:
        if (high - first).days > _MAX_SEARCH_DAYS:
            raise CalendarError(
                "calendar_too_few_working_days",
                "календарь не содержит достаточного количества рабочих дней для такой длительности",
            )
        if high == date.max:
            raise CalendarError(
                "calendar_date_out_of_range",
                "дата вышла за край поддерживаемого календаря",
            )
        try:
            high = high + timedelta(weeks=8)
        except OverflowError:
            high = date.max

    low = first
    while low < high:
        middle = low + (high - low) // 2
        if count_working_days(first, middle, cal) >= duration_days:
            high = middle
        else:
            low = middle + timedelta(days=1)

    if (low - first).days > _MAX_SEARCH_DAYS:
        raise CalendarError(
            "calendar_too_few_working_days",
            "календарь не содержит достаточного количества рабочих дней для такой длительности",
        )
    return low
