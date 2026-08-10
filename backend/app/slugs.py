import secrets
from collections.abc import Callable
from typing import TypeVar

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.text import slugify

MAX_ATTEMPTS = 5

T = TypeVar("T")


def _candidate(name: str, *, forced: bool, is_taken: Callable[[str], bool], fallback: str) -> str:
    base = slugify(name, fallback=fallback)
    if not forced and not is_taken(base):
        return base
    return f"{base}-{secrets.token_hex(3)}"


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
    """
    last_error: IntegrityError | None = None
    for attempt in range(MAX_ATTEMPTS):
        slug = _candidate(name, forced=attempt > 0, is_taken=is_taken, fallback=fallback)
        entity = build(slug)
        try:
            with db.begin_nested():
                db.add(entity)
                db.flush()
        except IntegrityError as exc:
            last_error = exc
            continue
        return entity
    raise last_error
