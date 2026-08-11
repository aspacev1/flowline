from datetime import date

import pytest

from app.calendar import WEEKDAYS_MON_FRI, Calendar, count_working_days, end_date

DEFAULT = Calendar()


def test_default_calendar_is_monday_to_friday():
    assert DEFAULT.working_days == WEEKDAYS_MON_FRI
    assert DEFAULT.is_working(date(2026, 3, 6)) is True   # пятница
    assert DEFAULT.is_working(date(2026, 3, 7)) is False  # суббота
    assert DEFAULT.is_working(date(2026, 3, 8)) is False  # воскресенье


def test_single_day_task_ends_on_its_start():
    assert end_date(date(2026, 3, 4), 1, DEFAULT) == date(2026, 3, 4)


def test_task_started_on_friday_skips_the_weekend():
    # пт 6 марта + 3 рабочих дня = пт, пн, вт
    assert end_date(date(2026, 3, 6), 3, DEFAULT) == date(2026, 3, 10)


def test_start_on_a_non_working_day_shifts_to_the_next_working_day():
    # суббота 7 марта, длительность 1 → понедельник 9 марта
    assert end_date(date(2026, 3, 7), 1, DEFAULT) == date(2026, 3, 9)


def test_holiday_is_skipped():
    cal = Calendar(holidays=frozenset({date(2026, 3, 9)}))
    # пт 6 марта + 3 дня: пт, вт (пн выходной по празднику), ср
    assert end_date(date(2026, 3, 6), 3, cal) == date(2026, 3, 11)


def test_extra_workday_beats_the_weekend_and_the_holiday():
    cal = Calendar(
        holidays=frozenset({date(2026, 3, 9)}),
        extra_workdays=frozenset({date(2026, 3, 7), date(2026, 3, 9)}),
    )
    assert cal.is_working(date(2026, 3, 7)) is True
    assert cal.is_working(date(2026, 3, 9)) is True


def test_non_standard_working_week():
    # рабочая неделя воскресенье–четверг: разряды 6,0,1,2,3
    mask = (1 << 6) | (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3)
    cal = Calendar(working_days=mask)
    assert cal.is_working(date(2026, 3, 8)) is True   # воскресенье
    assert cal.is_working(date(2026, 3, 6)) is False  # пятница


def test_count_working_days_is_inclusive_on_both_ends():
    assert count_working_days(date(2026, 3, 2), date(2026, 3, 6), DEFAULT) == 5
    assert count_working_days(date(2026, 3, 2), date(2026, 3, 8), DEFAULT) == 5
    assert count_working_days(date(2026, 3, 4), date(2026, 3, 4), DEFAULT) == 1


def test_count_working_days_rejects_reversed_range():
    with pytest.raises(ValueError):
        count_working_days(date(2026, 3, 6), date(2026, 3, 2), DEFAULT)


def test_duration_must_be_at_least_one_day():
    with pytest.raises(ValueError):
        end_date(date(2026, 3, 4), 0, DEFAULT)


def test_end_date_rejects_insufficient_working_days():
    """Календарь без достаточного количества рабочих дней должен поднять ошибку, а не висеть."""
    cal = Calendar(working_days=0, extra_workdays=frozenset({date(2026, 3, 6)}))
    # Только одна рабочая дата (6 марта), но требуем 2 дня
    with pytest.raises(ValueError, match="достаточного количества рабочих дней"):
        end_date(date(2026, 3, 6), 2, cal)


def test_end_date_respects_extra_workdays_priority_in_duration():
    """Дни из extra_workdays считаются в длительности даже если они в holidays."""
    # пт 6 марта, вс 8 марта в holidays, но вс в extra_workdays
    # пт 6 + вс 8 (extra) = 2 рабочих дня должно быть вс 8
    cal = Calendar(
        holidays=frozenset({date(2026, 3, 8)}),
        extra_workdays=frozenset({date(2026, 3, 8)}),
    )
    assert end_date(date(2026, 3, 6), 2, cal) == date(2026, 3, 8)


def test_a_calendar_failure_carries_a_machine_code():
    """Отказ календаря — не голый ValueError.

    Маршрут обязан отличить его от любой другой ошибки и ответить 422 с
    кодом; на голом ValueError ему пришлось бы разбирать текст сообщения.
    """
    from app.calendar import CalendarError

    empty = Calendar(working_days=0)
    with pytest.raises(CalendarError) as error:
        end_date(date(2026, 3, 4), 1, empty)
    assert error.value.code == "calendar_has_no_working_days"

    narrow = Calendar(working_days=0, extra_workdays=frozenset({date(2026, 3, 6)}))
    with pytest.raises(CalendarError) as error:
        end_date(date(2026, 3, 6), 2, narrow)
    assert error.value.code == "calendar_too_few_working_days"


def test_calendar_error_is_still_a_value_error():
    """Подкласс ValueError: прежние ловушки на ValueError продолжают работать."""
    from app.calendar import CalendarError

    assert issubclass(CalendarError, ValueError)
