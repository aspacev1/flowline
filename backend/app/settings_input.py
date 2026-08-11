"""Разбор и проверка настроек, приходящих из интерфейса.

Отдельно от маршрутов, потому что одни и те же величины настраиваются на двух
уровнях: рабочие дни, часовой пояс и порог сдвига есть и у организации, и у
проекта — с той разницей, что у проекта они допускают `null` («наследовать»).
Проверка, написанная в двух маршрутах порознь, разъедется на первой правке, и
разъедется молча: пропущенное значение просто ляжет в базу.
"""

from datetime import date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, field_validator

from app.config import get_settings
from app.text import slugify

# Маска рабочих дней — семь бит. Ноль запрещён: календарь без единого рабочего
# дня не позволяет посчитать ни одну дату окончания, и проект перестаёт
# читаться целиком. Отказать при вводе честнее, чем показать пятисотку потом.
MIN_WORKING_DAYS = 1
MAX_WORKING_DAYS = 0b1111111


class SettingsInput(BaseModel):
    """Общее для настроек всех уровней.

    `extra="forbid"`: опечатка в имени поля должна быть отказом, а не тихо
    проигнорированной строкой, после которой человек гадает, почему настройка
    не сохранилась.
    """

    model_config = ConfigDict(extra="forbid")


def check_timezone(value: str) -> str:
    """Часовой пояс — по имени из базы IANA, а не свободной строкой.

    Хранится он ради того, чтобы однажды показать даты в поясе проекта;
    непроверенное имя обнаружится в тот день, а не в день ввода.
    """
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        raise ValueError("неизвестный часовой пояс")
    return value


def check_locale(value: str) -> str:
    supported = get_settings().locales
    if value not in supported:
        raise ValueError(f"язык вне списка поддерживаемых: {', '.join(supported)}")
    return value


def check_dates(value: list) -> list[str]:
    """Список нерабочих (или, наоборот, рабочих) дат.

    Приводится к отсортированному набору без повторов: календарь — это
    множество дат, а не журнал того, в каком порядке их вводили. Заодно
    исчезает случай «одна и та же дата дважды», на котором список растёт
    молча.
    """
    parsed: set[date] = set()
    for item in value:
        if not isinstance(item, str):
            raise ValueError("дата должна быть строкой в формате ГГГГ-ММ-ДД")
        try:
            parsed.add(date.fromisoformat(item))
        except ValueError:
            raise ValueError(f"непригодная дата: {item!r}")
    return [day.isoformat() for day in sorted(parsed)]


def check_working_days(value: int) -> int:
    if not MIN_WORKING_DAYS <= value <= MAX_WORKING_DAYS:
        raise ValueError("маска рабочих дней вне диапазона или пуста")
    return value


class OrganizationSettingsIn(SettingsInput):
    """Уровень 2: дефолты организации, которые наследуют все её проекты."""

    name: str | None = None
    slug: str | None = None
    default_locale: str | None = None
    default_timezone: str | None = None
    working_days: int | None = None
    week_start: int | None = None
    holiday_calendar: list | None = None
    default_shift_threshold_days: int | None = None
    public_sharing_enabled: bool | None = None
    default_comments_enabled: bool | None = None

    @field_validator("default_timezone")
    @classmethod
    def _timezone(cls, value: str | None) -> str | None:
        return None if value is None else check_timezone(value)

    @field_validator("default_locale")
    @classmethod
    def _locale(cls, value: str | None) -> str | None:
        return None if value is None else check_locale(value)

    @field_validator("working_days")
    @classmethod
    def _working_days(cls, value: int | None) -> int | None:
        return None if value is None else check_working_days(value)

    @field_validator("week_start")
    @classmethod
    def _week_start(cls, value: int | None) -> int | None:
        if value is not None and not 0 <= value <= 6:
            raise ValueError("первый день недели вне 0..6")
        return value

    @field_validator("default_shift_threshold_days")
    @classmethod
    def _threshold(cls, value: int | None) -> int | None:
        if value is not None and value < 0:
            raise ValueError("порог не может быть отрицательным")
        return value

    @field_validator("holiday_calendar")
    @classmethod
    def _holidays(cls, value: list | None) -> list | None:
        return None if value is None else check_dates(value)

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str | None) -> str | None:
        """Слаг приводится к своей форме здесь, а не у вызывающего.

        Иначе `slug-check` и сохранение расходятся: поле ввода показывает
        `redizayn-2026`, а в базу ложится «Редизайн 2026» — и публичный адрес
        оказывается не тем, который человеку только что показали. Пустая форма
        («...», одни пробелы) заменяется запасным словом: адрес без слага не
        открывается вовсе.
        """
        return None if value is None else slugify(value, fallback="org")


    @field_validator("name", "slug")
    @classmethod
    def _not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("значение не может быть пустым")
        return stripped


class ProjectSettingsIn(SettingsInput):
    """Уровень 3: настройки проекта.

    Три величины здесь допускают `null`, и `null` означает «наследовать от
    организации», а не «пусто». Отличить «прислали null» от «не прислали
    вовсе» позволяет `model_fields_set`: без этого сброс переопределения был
    бы невыразим — любой запрос без поля стирал бы его.
    """

    name: str | None = None
    slug: str | None = None
    deadline: date | None = None
    timezone: str | None = None
    working_days: int | None = None
    shift_threshold_days: int | None = None
    holidays_extra: list | None = None
    workdays_extra: list | None = None

    @field_validator("timezone")
    @classmethod
    def _timezone(cls, value: str | None) -> str | None:
        return None if value is None else check_timezone(value)

    @field_validator("working_days")
    @classmethod
    def _working_days(cls, value: int | None) -> int | None:
        return None if value is None else check_working_days(value)

    @field_validator("shift_threshold_days")
    @classmethod
    def _threshold(cls, value: int | None) -> int | None:
        if value is not None and value < 0:
            raise ValueError("порог не может быть отрицательным")
        return value

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str | None) -> str | None:
        """Слаг приводится к своей форме здесь, а не у вызывающего.

        Иначе `slug-check` и сохранение расходятся: поле ввода показывает
        `redizayn-2026`, а в базу ложится «Редизайн 2026» — и публичный адрес
        оказывается не тем, который человеку только что показали. Пустая форма
        («...», одни пробелы) заменяется запасным словом: адрес без слага не
        открывается вовсе.
        """
        return None if value is None else slugify(value, fallback="project")

    @field_validator("holidays_extra", "workdays_extra")
    @classmethod
    def _dates(cls, value: list | None) -> list | None:
        return None if value is None else check_dates(value)

    @field_validator("name", "slug")
    @classmethod
    def _not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("значение не может быть пустым")
        return stripped


# Поля, которым `null` разрешён как значение («наследовать от организации»).
# Всё остальное `null`-ом только помечается как «не менять».
NULLABLE_PROJECT_FIELDS = frozenset({"deadline", "timezone", "working_days", "shift_threshold_days"})


def changes(payload: SettingsInput, *, nullable: frozenset[str] = frozenset()) -> dict:
    """Присланные поля → набор изменений.

    Поле, которого не было в теле запроса, не меняется вовсе. Поле со
    значением `null` либо сбрасывается в «наследовать» (если оно из
    `nullable`), либо игнорируется — потому что для остальных `null` не
    значение, а отсутствие ответа.
    """
    sent = payload.model_dump(exclude_unset=True)
    return {
        field: value
        for field, value in sent.items()
        if value is not None or field in nullable
    }
