import secrets
from collections.abc import Callable
from typing import TypeVar

from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.text import SLUG_MAX_LEN, slugify

MAX_ATTEMPTS = 5

T = TypeVar("T")


def _with_suffix(base: str, suffix: str) -> str:
    """База с суффиксом, вместе не длиннее колонки.

    Суффикс пришивается к уже обрезанному слагу, поэтому урезается база, а не
    суффикс: суффикс — это и есть гарантия уникальности, терять его символы
    нельзя.
    """
    trimmed = base[: SLUG_MAX_LEN - len(suffix)].rstrip("-")
    return f"{trimmed}{suffix}"


def _candidate(name: str, *, forced: bool, is_taken: Callable[[str], bool], fallback: str) -> str:
    base = slugify(name, fallback=fallback)
    if not forced and not is_taken(base):
        return base
    return _with_suffix(base, f"-{secrets.token_hex(3)}")


def suggest_free_slug(
    raw: str, *, is_taken: Callable[[str], bool], fallback: str = "project", limit: int = 20
) -> str:
    """Свободный слаг, похожий на желаемый.

    Нужен форме, а не вставке: занятый слаг обязан подсказать свободный
    вариант прямо в поле ввода, до отправки. Поэтому суффикс здесь числовой и
    по порядку — `redesign-2`, `redesign-3`, — а не случайный, как при
    вставке: подсказку человек читает и вводит с голоса, и шесть
    шестнадцатеричных цифр в ней бесполезны.

    Случайный суффикс остаётся последним средством: если заняты и первые
    двадцать номеров, перебирать дальше дороже, чем предложить заведомо
    свободное имя.
    """
    base = slugify(raw, fallback=fallback)
    if not is_taken(base):
        return base
    for number in range(2, limit + 2):
        candidate = _with_suffix(base, f"-{number}")
        if not is_taken(candidate):
            return candidate
    return _with_suffix(base, f"-{secrets.token_hex(3)}")


def slug_check(raw: str, *, is_taken: Callable[[str], bool], fallback: str = "project") -> dict:
    """Ответ поля ввода: во что превратится введённое, свободно ли оно и что
    предложить взамен.

    Нормализованная форма отдаётся отдельно от подсказки, потому что это
    разные ответы на разные вопросы: первый — «вот каким будет адрес», второй —
    «а вот таким, если этот занят». Слив их в одно поле, интерфейс не смог бы
    отличить «всё хорошо» от «мы подобрали за вас».
    """
    normalized = slugify(raw, fallback=fallback)
    available = not is_taken(normalized)
    return {
        "normalized": normalized,
        "available": available,
        "suggestion": normalized
        if available
        else suggest_free_slug(raw, is_taken=is_taken, fallback=fallback),
    }


def insert_with_unique_slug(
    db: DbSession,
    build: Callable[[str], T],
    *,
    name: str,
    is_taken: Callable[[str], bool],
    fallback: str = "project",
) -> T:
    """Вставляет сущность со слагом, выведенным из названия.

    Проверить занятость и вставить — не одно и то же действие: между SELECT и
    INSERT успевает пройти конкурентный запрос, и уникальный индекс отвергает
    вставку. Поэтому проверка здесь — только чтобы не вешать суффикс без
    нужды, а настоящая защита — ограничение в базе: коллизия ловится,
    откатывается до SAVEPOINT (иначе прерванной оказалась бы вся транзакция
    сессии) и попытка повторяется с новым случайным суффиксом.

    Коллизия слага — не вина того, кто пришёл вторым: его организация или
    проект просто называются как уже существующие. Поэтому цикл, а не отказ.
    Число попыток ограничено, чтобы IntegrityError по другой причине —
    например, по внешнему ключу — не превратился в вечный цикл: исчерпав
    попытки, поднимаем последнюю ошибку как есть.

    DataError ловится наравне с IntegrityError: слаг обрезается до колонки
    ещё в slugify, но у сущности есть и другие строковые поля, а прерванной
    без отката до SAVEPOINT осталась бы вся транзакция сессии — вместе с
    изменениями, не имеющими к слагу никакого отношения.
    """
    last_error: DataError | IntegrityError | None = None
    for attempt in range(MAX_ATTEMPTS):
        slug = _candidate(name, forced=attempt > 0, is_taken=is_taken, fallback=fallback)
        entity = build(slug)
        try:
            with db.begin_nested():
                db.add(entity)
                db.flush()
        except (DataError, IntegrityError) as exc:
            last_error = exc
            continue
        return entity
    raise last_error
