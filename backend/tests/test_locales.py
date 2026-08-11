"""Язык при первом появлении человека — из `Accept-Language`.

Правило раздела 9: при первом входе язык берётся из заголовка, если тот
просит один из трёх поддерживаемых; иначе — азербайджанский. Дальше только то,
что человек выбрал сам.
"""

import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.locales import preferred_locale
from app.main import app

SUPPORTED = ["az", "en", "ru"]


@pytest.fixture
def client(db):
    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.parametrize(
    "header,expected",
    [
        ("ru", "ru"),
        ("en-US,en;q=0.9", "en"),
        # Регион отбрасывается: продукт различает языки, а не диалекты.
        ("ru-RU", "ru"),
        # Порядок решают веса, а не место в строке.
        ("de;q=0.9,ru;q=0.4,en;q=0.8", "en"),
        # При равных весах побеждает названный раньше.
        ("en,ru", "en"),
        # Ни одного поддерживаемого — язык по умолчанию.
        ("de-DE,fr;q=0.8", "az"),
        ("*", "az"),
        ("", "az"),
        (None, "az"),
        # Испорченный вес не отменяет разбор всего заголовка.
        ("ru;q=abc,en", "en"),
    ],
)
def test_preferred_locale(header, expected):
    assert preferred_locale(header, SUPPORTED, "az") == expected


def test_the_case_of_the_tag_does_not_depend_on_the_locale_of_the_process():
    """Азербайджанская i-ловушка на кодах языков.

    Приведение регистра в локали пользователя превращает `I` в `ı`, и один и
    тот же заголовок начал бы разбираться по-разному в зависимости от того,
    чья локаль оказалась активной. `casefold` от локали процесса не зависит
    вовсе.
    """
    assert preferred_locale("RU", SUPPORTED, "az") == "ru"
    assert preferred_locale("EN-GB", SUPPORTED, "az") == "en"
    # Заглавная I в коде языка не должна превратиться в ı и потерять «ru».
    assert preferred_locale("IT,ru", SUPPORTED, "az") == "ru"


def test_registration_takes_the_language_from_the_browser(client):
    response = client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
        headers={"Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8"},
    )

    assert response.status_code == 201
    assert response.json()["locale"] == "ru"


def test_registration_falls_back_to_azerbaijani(client):
    response = client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
        headers={"Accept-Language": "fr-FR,de;q=0.8"},
    )

    assert response.json()["locale"] == "az"


def test_the_header_is_never_asked_again(client):
    """Заголовок читается один раз — при первом появлении.

    Иначе смена языка в браузере молча переписывала бы выбор, сделанный
    человеком руками.
    """
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
        headers={"Accept-Language": "ru"},
    )
    client.patch("/api/auth/me", json={"locale": "az"})

    profile = client.get("/api/auth/me", headers={"Accept-Language": "en"})

    assert profile.json()["locale"] == "az"
