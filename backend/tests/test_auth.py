from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.auth_routes import _cookie_is_secure
from app.auth import SESSION_COOKIE, authenticate, close_session, current_user, open_session, register
from app.config import get_settings
from app.db import get_db
from app.main import app
from app.models import Membership, Organization, Role, Session
from app.security import hash_password, hash_token, verify_password


def test_password_hash_is_not_the_password():
    hashed = hash_password("correct horse battery staple")
    assert hashed != "correct horse battery staple"
    assert verify_password("correct horse battery staple", hashed) is True
    assert verify_password("wrong", hashed) is False


def test_registration_creates_user_org_and_owner_membership(db):
    user = register(db, name="Alex", email="Alex@Example.com", password="s3cret-pass")
    db.flush()

    assert user.email == "alex@example.com"

    membership = db.query(Membership).filter_by(user_id=user.id).one()
    assert membership.role == Role.OWNER

    org = db.get(Organization, membership.org_id)
    assert org.name == "Alex"
    assert org.slug == "alex"


def test_registration_rejects_a_duplicate_email_regardless_of_case(db):
    register(db, name="Alex", email="alex@example.com", password="s3cret-pass")
    db.flush()

    with pytest.raises(ValueError, match="занят"):
        register(db, name="Other", email="ALEX@example.com", password="other-pass")


def test_org_slug_gets_a_suffix_when_taken(db):
    register(db, name="Acme", email="one@example.com", password="s3cret-pass")
    db.flush()
    second = register(db, name="Acme", email="two@example.com", password="s3cret-pass")
    db.flush()

    membership = db.query(Membership).filter_by(user_id=second.id).one()
    org = db.get(Organization, membership.org_id)
    assert org.slug.startswith("acme-")


def test_org_slug_collision_at_insert_time_retries_instead_of_failing(db, monkeypatch):
    """Симулирует гонку: SELECT-проверка слага устарела (как если бы её
    прошёл конкурентный запрос за долю секунды до нас), и первая попытка
    вставки словит IntegrityError на уникальном индексе. register() должен
    тихо повторить попытку с новым суффиксом, а не поднять исключение."""
    import app.auth as auth_module

    register(db, name="Acme", email="first@example.com", password="s3cret-pass")
    db.flush()

    original = auth_module._org_slug_candidate
    calls = {"n": 0}

    def flaky(db_, name, *, forced):
        calls["n"] += 1
        if calls["n"] == 1:
            return "acme"  # уже занято first@example.com — вставка упадёт
        return original(db_, name, forced=True)

    monkeypatch.setattr(auth_module, "_org_slug_candidate", flaky)

    second = register(db, name="Acme", email="second@example.com", password="s3cret-pass")
    db.flush()

    membership = db.query(Membership).filter_by(user_id=second.id).one()
    org = db.get(Organization, membership.org_id)
    assert org.slug != "acme"
    assert calls["n"] >= 2


def test_authenticate_accepts_the_right_password_and_rejects_the_wrong_one(db):
    register(db, name="Alex", email="alex@example.com", password="s3cret-pass")
    db.flush()

    assert authenticate(db, email="ALEX@example.com", password="s3cret-pass") is not None
    assert authenticate(db, email="alex@example.com", password="nope") is None
    assert authenticate(db, email="ghost@example.com", password="s3cret-pass") is None


# ---- Жизненный цикл сессии --------------------------------------------------


def test_expired_session_does_not_authenticate(db):
    user = register(db, name="Alex", email="alex@example.com", password="s3cret-pass")
    db.flush()

    raw = "expired-raw-token"
    db.add(
        Session(
            user_id=user.id,
            token_hash=hash_token(raw),
            expires_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
    )
    db.flush()

    with pytest.raises(HTTPException) as exc_info:
        current_user(flowline_session=raw, db=db)
    assert exc_info.value.status_code == 401


def test_missing_cookie_is_rejected(db):
    with pytest.raises(HTTPException) as exc_info:
        current_user(flowline_session=None, db=db)
    assert exc_info.value.status_code == 401


def test_logout_invalidates_the_server_side_session_not_just_the_cookie(db):
    user = register(db, name="Alex", email="alex@example.com", password="s3cret-pass")
    db.flush()
    raw = open_session(db, user)
    db.flush()

    assert current_user(flowline_session=raw, db=db).id == user.id

    close_session(db, raw)
    db.flush()

    with pytest.raises(HTTPException) as exc_info:
        current_user(flowline_session=raw, db=db)
    assert exc_info.value.status_code == 401


# ---- Маршруты через TestClient ----------------------------------------------


@pytest.fixture
def client(db):
    """TestClient, у которого get_db переопределён на сессию фикстуры `db`.

    Переопределение отдаёт ровно ту же сессию и не делает commit — иначе
    внешняя транзакция фикстуры `db` закрылась бы раньше времени и
    изоляция между тестами исчезла бы (см. tests/conftest.py).
    """

    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_register_route_returns_201_and_sets_an_httponly_cookie(client):
    response = client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "alex@example.com"
    assert SESSION_COOKIE in response.cookies

    set_cookie_header = response.headers.get("set-cookie", "")
    assert "HttpOnly" in set_cookie_header


def test_me_route_returns_the_authenticated_user(client):
    register_response = client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    user_id = register_response.json()["id"]

    me_response = client.get("/api/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["id"] == user_id


def test_me_route_without_a_cookie_is_401(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401


def test_register_route_rejects_a_duplicate_address_with_409(client):
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    response = client.post(
        "/api/auth/register",
        json={"name": "Other", "email": "ALEX@example.com", "password": "other-pass"},
    )
    assert response.status_code == 409


def test_login_route_rejects_a_wrong_password_with_401(client):
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    response = client.post(
        "/api/auth/login", json={"email": "alex@example.com", "password": "wrong"}
    )
    assert response.status_code == 401


def test_register_route_maps_an_unprotected_integrity_error_to_409(client, monkeypatch):
    """Защитная сетка маршрута: даже если register() когда-нибудь пропустит
    IntegrityError (например, после будущей правки, не защищённой
    SAVEPOINT-ом), маршрут не должен отвечать 500."""
    import app.api.auth_routes as routes_module
    from sqlalchemy.exc import IntegrityError

    def boom(*args, **kwargs):
        raise IntegrityError("insert", {}, Exception("unique violation"))

    monkeypatch.setattr(routes_module, "register", boom)

    response = client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    assert response.status_code == 409


def test_logout_route_kills_the_session_so_the_same_cookie_stops_working(client):
    register_response = client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    assert register_response.status_code == 201

    logout_response = client.post("/api/auth/logout")
    assert logout_response.status_code == 204

    me_response = client.get("/api/auth/me")
    assert me_response.status_code == 401


# ---- Атрибут Secure куки следует за схемой PUBLIC_BASE_URL -----------------


def test_cookie_is_secure_when_public_base_url_is_https(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://flowline.example.com")
    get_settings.cache_clear()
    try:
        assert _cookie_is_secure() is True
    finally:
        get_settings.cache_clear()


def test_cookie_is_not_secure_when_public_base_url_is_http(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://localhost:8000")
    get_settings.cache_clear()
    try:
        assert _cookie_is_secure() is False
    finally:
        get_settings.cache_clear()
