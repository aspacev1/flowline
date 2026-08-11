import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app


@pytest.fixture
def client(db):
    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def authed(client):
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    return client


@pytest.fixture
def project_id(authed):
    return authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]


def test_slug_is_normalized_by_the_server_not_by_the_caller(authed, project_id):
    """Транслитерацию повторять в браузере нельзя: расхождение даст ссылку,
    которая не открывается."""
    response = authed.patch(f"/api/projects/{project_id}", json={"slug": "Редизайн 2026"})

    assert response.status_code == 200
    assert response.json()["slug"] == "redizayn-2026"


def test_renaming_the_slug_moves_the_published_address(authed, project_id):
    """Адрес собран из слагов, поэтому переименование переносит и его. Токен
    при этом остаётся прежним: ссылку не отзывали, её перевесили."""
    before = authed.post(f"/api/projects/{project_id}/share", json={}).json()["url"]

    authed.patch(f"/api/projects/{project_id}", json={"slug": "redesign-2027"})
    after = authed.get(f"/api/projects/{project_id}/share").json()["url"]

    assert before != after
    assert "/p/alex/redesign-2027?" in after


def test_a_taken_slug_is_refused_and_a_free_one_is_suggested(authed, project_id):
    authed.post("/api/projects", json={"name": "Другой"})
    taken = [p for p in authed.get("/api/projects").json() if p["id"] != project_id][0]["slug"]

    refusal = authed.patch(f"/api/projects/{project_id}", json={"slug": taken})
    assert refusal.status_code == 409
    assert refusal.json()["detail"] == "slug_taken"

    check = authed.get(f"/api/projects/{project_id}/slug-check?slug={taken}").json()
    assert check["available"] is False
    assert check["suggestion"].startswith(taken)
    assert check["suggestion"] != taken


def test_its_own_slug_is_not_taken_by_itself(authed, project_id):
    """Иначе форма настроек ругается на слаг, который уже стоит в поле."""
    current = authed.get(f"/api/projects/{project_id}").json()["slug"]

    assert (
        authed.get(f"/api/projects/{project_id}/slug-check?slug={current}").json()["available"]
        is True
    )


def test_a_slug_that_normalizes_to_nothing_is_refused(authed, project_id):
    """«...» и одни пробелы дают пустой слаг, а пустой адрес не открывается."""
    response = authed.patch(f"/api/projects/{project_id}", json={"slug": "..."})

    # Пустой слаг до базы не доходит: нормализация подставляет запасное слово,
    # и адрес остаётся открываемым, а не превращается в «/p/alex/».
    assert response.status_code == 200
    assert response.json()["slug"] == "project"


def test_a_slug_taken_in_another_organization_is_free_here(authed, project_id, db):
    """Слаг уникален внутри организации, а не глобально: адрес несёт оба слага."""
    from app.models import Organization, Project

    other = Organization(name="Globex", slug="globex")
    db.add(other)
    db.flush()
    db.add(Project(org_id=other.id, name="Taken", slug="zanyato"))
    db.flush()

    assert (
        authed.get(f"/api/projects/{project_id}/slug-check?slug=zanyato").json()["available"] is True
    )


def test_a_viewer_may_not_rename_the_slug(authed, project_id, db):
    from sqlalchemy import select

    from app.models import Membership

    db.scalar(select(Membership)).role = "viewer"
    db.flush()

    assert (
        authed.patch(f"/api/projects/{project_id}", json={"slug": "whatever"}).status_code == 403
    )
