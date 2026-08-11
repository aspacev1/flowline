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


def test_settings_show_the_address_before_it_is_published(authed, project_id):
    """Адрес известен заранее: он выведен из слагов, а не выдан публикацией.
    Владелец должен видеть, что именно он собирается открыть."""
    settings = authed.get(f"/api/projects/{project_id}/settings").json()

    assert settings["public_url"].endswith("/p/alex/redesign")
    assert settings["share"]["published"] is False


def test_publishing_and_revoking_flip_the_same_field(authed, project_id):
    published = authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": True, "comments_enabled": True},
    )
    assert published.status_code == 200
    assert published.json()["published"] is True

    revoked = authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": False, "comments_enabled": True},
    )
    assert revoked.json()["published"] is False
    assert authed.get(f"/api/projects/{project_id}/settings").json()["share"]["published"] is False


def test_comments_switch_survives_republishing(authed, project_id):
    """Переключателем распоряжается владелец проекта: повторная публикация не
    должна возвращать умолчание организации поверх его решения."""
    authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": True, "comments_enabled": False},
    )
    authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": False, "comments_enabled": False},
    )
    again = authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": True, "comments_enabled": False},
    )

    assert again.json()["comments_enabled"] is False


def test_a_viewer_may_not_publish_a_project(authed, project_id, db):
    """Открыть проект миру — не то же, что поправить задачу: право отдельное."""
    from sqlalchemy import select

    from app.models import Membership

    db.scalar(select(Membership)).role = "viewer"
    db.flush()

    response = authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": True, "comments_enabled": True},
    )
    assert response.status_code == 403


def test_organization_that_forbids_sharing_refuses_publication(authed, project_id, db):
    from sqlalchemy import select

    from app.models import Organization

    db.scalar(select(Organization)).public_sharing_enabled = False
    db.flush()

    response = authed.put(
        f"/api/projects/{project_id}/share",
        json={"published": True, "comments_enabled": True},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "public_sharing_disabled"


def test_settings_of_another_organization_are_not_reachable(authed, db):
    from app.models import Organization, Project

    other = Organization(name="Globex", slug="globex")
    db.add(other)
    db.flush()
    stranger = Project(org_id=other.id, name="Secret", slug="secret")
    db.add(stranger)
    db.flush()

    assert authed.get(f"/api/projects/{stranger.id}/settings").status_code == 404
    assert (
        authed.put(
            f"/api/projects/{stranger.id}/share",
            json={"published": True, "comments_enabled": True},
        ).status_code
        == 404
    )
