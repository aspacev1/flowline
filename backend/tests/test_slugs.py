"""Слаги при вставке: длина колонки и живучесть транзакции (волна 1.3).

Уникальность через SAVEPOINT покрыта тестами API; здесь — то, что раньше
кончалось пятисоткой: слаг длиннее колонки и DataError, оставлявший всю
транзакцию сессии прерванной.
"""

import pytest
from sqlalchemy.exc import DataError

from app.models import Organization
from app.slugs import insert_with_unique_slug, suggest_free_slug
from app.text import SLUG_MAX_LEN


def _taken_none(_slug: str) -> bool:
    return False


def test_insert_with_a_long_name_fits_the_column(db):
    org = insert_with_unique_slug(
        db,
        lambda slug: Organization(name="Щ" * 100, slug=slug),
        name="Щ" * 100,
        is_taken=_taken_none,
        fallback="org",
    )
    assert len(org.slug) <= SLUG_MAX_LEN


def test_the_uniqueness_suffix_never_pushes_the_slug_past_the_column(db):
    long_name = "redizayn " * 20  # база упрётся в потолок ещё до суффикса

    org = insert_with_unique_slug(
        db,
        lambda slug: Organization(name=long_name, slug=slug),
        name=long_name,
        is_taken=lambda _slug: True,  # первая попытка «занята» → пришивается суффикс
        fallback="org",
    )
    assert len(org.slug) <= SLUG_MAX_LEN
    # Суффикс — гарантия уникальности, урезается база, а не он.
    assert org.slug[-7] == "-"


def test_suggested_slugs_fit_the_column_too():
    base = "a" * SLUG_MAX_LEN
    suggestion = suggest_free_slug(base, is_taken=lambda slug: slug == base)
    assert suggestion != base
    assert len(suggestion) <= SLUG_MAX_LEN


def test_a_data_error_rolls_back_to_the_savepoint_and_surfaces(db):
    """DataError по чужому полю не превращается в прерванную транзакцию.

    Слаг обрезан, но у сущности есть и другие строковые колонки. До
    исправления DataError вылетал из insert_with_unique_slug без отката до
    SAVEPOINT, и любое следующее обращение сессии отвечало InFailedSqlTransaction
    — то есть одна ошибка формы валила весь запрос целиком.
    """
    with pytest.raises(DataError):
        insert_with_unique_slug(
            db,
            # name длиннее varchar(200) — усечение, ловить которое должен
            # тот же SAVEPOINT, что и коллизию слага.
            lambda slug: Organization(name="x" * 300, slug=slug),
            name="Acme",
            is_taken=_taken_none,
            fallback="org",
        )

    # Сессия жива: SAVEPOINT откатился, транзакция не прервана.
    survivor = insert_with_unique_slug(
        db,
        lambda slug: Organization(name="Acme", slug=slug),
        name="Acme",
        is_taken=_taken_none,
        fallback="org",
    )
    assert survivor.id is not None
