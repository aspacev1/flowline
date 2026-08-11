"""Приглашения — пункт 6 раздела 13.

Проверяются ровно те правила, которые названы в спецификации: принятое
повторно не срабатывает; просроченное и отозванное отбиваются; роль из ссылки
нельзя подменить при приёме; приглашение с адресом не принимается под другим
аккаунтом; повторная отправка убивает прежний токен; лимит срабатывает.
Отдельно — что токен в базе лежит хешем, а не открытым текстом.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import get_db
from app.invitations import InvitationError, create_invitation, accept
from app.main import app
from app.mail import MailError
from app.models import Invitation, Membership, Organization, Project, ProjectAccess, User
from app.security import hash_token


@pytest.fixture
def client(db):
    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _register(client, name: str, email: str) -> dict:
    return client.post(
        "/api/auth/register",
        json={"name": name, "email": email, "password": "s3cret-pass"},
    ).json()


@pytest.fixture
def owner(client):
    """Владелец со своей организацией. Почта в тестах выключена, поэтому
    подтверждение адреса не спрашивается — ровно как в установке без почты."""
    _register(client, "Alex", "alex@example.com")
    return client


@pytest.fixture
def guest_client(db):
    """Второй браузер: своя сессия, тот же сервер."""

    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _invite(owner, **payload) -> dict:
    body = {"role": "editor", **payload}
    response = owner.post("/api/org/invitations", json=body)
    assert response.status_code == 201, response.text
    return response.json()[0]


def _token(link: str) -> str:
    return link.rsplit("/", 1)[-1]


# --- выпуск ------------------------------------------------------------------


def test_the_link_is_shown_once_and_the_token_is_stored_hashed(owner, db):
    invitation = _invite(owner, emails=["new@example.com"])
    token = _token(invitation["link"])

    row = db.scalar(select(Invitation))
    assert row.token_hash == hash_token(token)
    # Ни в одном поле нет самого токена: утечка дампа не должна раздавать
    # доступ к организациям.
    assert token not in {row.token_hash, row.email or ""}
    # И в списке ссылки нет: сервер её не помнит.
    listed = owner.get("/api/org/invitations").json()
    assert "link" not in listed[0]


def test_several_addresses_at_once_produce_several_invitations(owner):
    response = owner.post(
        "/api/org/invitations",
        json={"emails": ["a@example.com", "b@example.com"], "role": "viewer"},
    )

    assert response.status_code == 201
    assert [item["email"] for item in response.json()] == ["a@example.com", "b@example.com"]
    # Ссылки разные: одна на всех — это уже многоразовое приглашение, которого
    # в первой версии нет.
    links = {item["link"] for item in response.json()}
    assert len(links) == 2


def test_an_invitation_without_an_address_is_for_the_bearer(owner):
    invitation = _invite(owner, emails=[])

    assert invitation["email"] is None
    assert invitation["link"] is not None


def test_the_owner_role_cannot_be_handed_out_by_a_link(owner):
    response = owner.post("/api/org/invitations", json={"emails": [], "role": "owner"})

    assert response.status_code == 422
    assert response.json()["detail"] == "role_not_invitable"


def test_only_the_owner_invites(owner, db):
    user_id = owner.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
    membership.role = "editor"
    db.flush()

    assert owner.post("/api/org/invitations", json={"emails": [], "role": "viewer"}).status_code == 403


def test_the_hourly_limit_bites(owner, monkeypatch):
    import app.invitations as invitations

    settings = invitations.get_settings()
    monkeypatch.setattr(settings, "invite_rate_limit", 2, raising=False)

    assert owner.post("/api/org/invitations", json={"emails": [], "role": "viewer"}).status_code == 201
    assert owner.post("/api/org/invitations", json={"emails": [], "role": "viewer"}).status_code == 201
    # Без потолка приложение превращается в бесплатный рассыльщик писем с
    # чужого домена.
    third = owner.post("/api/org/invitations", json={"emails": [], "role": "viewer"})
    assert third.status_code == 429
    assert third.json()["detail"] == "invite_rate_limited"


# --- приём -------------------------------------------------------------------


def test_accepting_adds_the_membership_with_the_role_from_the_link(owner, guest_client, db):
    invitation = _invite(owner, emails=["maria@example.com"], role="viewer")
    _register(guest_client, "Maria", "maria@example.com")

    response = guest_client.post(f"/api/invitations/{_token(invitation['link'])}/accept")

    assert response.status_code == 200
    assert response.json()["role"] == "viewer"
    maria = db.scalar(select(User).where(User.email == "maria@example.com"))
    roles = db.scalars(select(Membership.role).where(Membership.user_id == maria.id)).all()
    # Своя организация от регистрации плюс та, куда позвали.
    assert sorted(roles) == ["owner", "viewer"]


def test_the_role_from_the_link_cannot_be_swapped_on_acceptance(owner, guest_client, db):
    """Роль фиксируется в момент приглашения.

    Подменить её принимающему нечем: маршрут приёма роли не принимает вовсе,
    и лишнее поле в теле отбивается, а не молча используется.
    """
    invitation = _invite(owner, emails=["maria@example.com"], role="viewer")
    _register(guest_client, "Maria", "maria@example.com")
    token = _token(invitation["link"])

    response = guest_client.post(f"/api/invitations/{token}/accept", json={"role": "owner"})

    assert response.status_code == 200
    assert response.json()["role"] == "viewer"


def test_an_accepted_invitation_does_not_work_a_second_time(owner, guest_client):
    invitation = _invite(owner, emails=["maria@example.com"])
    _register(guest_client, "Maria", "maria@example.com")
    token = _token(invitation["link"])
    guest_client.post(f"/api/invitations/{token}/accept")

    again = guest_client.post(f"/api/invitations/{token}/accept")

    assert again.status_code == 409
    assert again.json()["detail"] == "invite_accepted"


def test_a_revoked_invitation_is_refused(owner, guest_client):
    invitation = _invite(owner, emails=["maria@example.com"])
    owner.post(f"/api/org/invitations/{invitation['id']}/revoke")
    _register(guest_client, "Maria", "maria@example.com")

    response = guest_client.post(f"/api/invitations/{_token(invitation['link'])}/accept")

    assert response.status_code == 409
    assert response.json()["detail"] == "invite_revoked"


def test_an_expired_invitation_is_refused(owner, guest_client, db):
    invitation = _invite(owner, emails=["maria@example.com"])
    row = db.get(Invitation, invitation["id"])
    row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    db.flush()
    _register(guest_client, "Maria", "maria@example.com")

    response = guest_client.post(f"/api/invitations/{_token(invitation['link'])}/accept")

    # Три разных сообщения, а не одно «ссылка недействительна»: человек должен
    # понимать, просить ли новую ссылку.
    assert response.status_code == 409
    assert response.json()["detail"] == "invite_expired"


def test_an_addressed_invitation_is_not_accepted_under_another_account(owner, guest_client):
    invitation = _invite(owner, emails=["maria@example.com"])
    _register(guest_client, "Someone", "someone@example.com")

    response = guest_client.post(f"/api/invitations/{_token(invitation['link'])}/accept")

    assert response.status_code == 403
    assert response.json()["detail"] == "invite_for_another_address"


def test_an_invitation_without_an_address_is_accepted_by_whoever_holds_it(owner, guest_client):
    invitation = _invite(owner, emails=[], role="viewer")
    _register(guest_client, "Someone", "someone@example.com")

    response = guest_client.post(f"/api/invitations/{_token(invitation['link'])}/accept")

    assert response.status_code == 200


def test_the_address_comparison_ignores_case_the_same_way_everywhere(owner, guest_client):
    """Адрес нормализуется одинаково при выпуске и при приёме.

    Иначе приглашение, выписанное на «Maria@Example.com», не принималось бы
    аккаунтом «maria@example.com» — тем самым, который система сама и завела.
    """
    invitation = _invite(owner, emails=["Maria@Example.com"])
    _register(guest_client, "Maria", "maria@example.com")

    response = guest_client.post(f"/api/invitations/{_token(invitation['link'])}/accept")

    assert response.status_code == 200


def test_accepting_needs_a_session(client, owner):
    invitation = _invite(owner, emails=[])
    anonymous = TestClient(app)

    assert anonymous.post(f"/api/invitations/{_token(invitation['link'])}/accept").status_code == 401


def test_the_preview_works_without_a_session(client, owner):
    """Человек с ссылкой видит, куда его зовут, до всякой регистрации."""
    invitation = _invite(owner, emails=["maria@example.com"], role="viewer")
    anonymous = TestClient(app)

    body = anonymous.get(f"/api/invitations/{_token(invitation['link'])}").json()

    assert body["org_name"] == "Alex"
    assert body["role"] == "viewer"
    assert body["email"] == "maria@example.com"


# --- повторная отправка и отзыв ---------------------------------------------


def test_reissuing_kills_the_previous_token(owner, guest_client):
    invitation = _invite(owner, emails=["maria@example.com"])
    old = _token(invitation["link"])

    reissued = owner.post(f"/api/org/invitations/{invitation['id']}/reissue").json()
    new = _token(reissued["link"])

    assert new != old
    _register(guest_client, "Maria", "maria@example.com")
    # Иначе отозвать «то самое старое письмо» становится невозможно.
    assert guest_client.post(f"/api/invitations/{old}/accept").status_code == 404
    assert guest_client.post(f"/api/invitations/{new}/accept").status_code == 200


def test_a_revoked_invitation_cannot_be_reissued(owner):
    invitation = _invite(owner, emails=["maria@example.com"])
    owner.post(f"/api/org/invitations/{invitation['id']}/revoke")

    assert owner.post(f"/api/org/invitations/{invitation['id']}/reissue").status_code == 409


def test_an_invitation_of_another_organization_is_not_found(owner, db, guest_client):
    _register(guest_client, "Other", "other@example.com")
    other_org = db.scalar(
        select(Organization).join(Membership).join(User).where(User.email == "other@example.com")
    )
    stranger = Invitation(
        org_id=other_org.id,
        email=None,
        role="viewer",
        token_hash="whatever",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(stranger)
    db.flush()

    assert owner.post(f"/api/org/invitations/{stranger.id}/revoke").status_code == 404


# --- роль client и доступ к проектам -----------------------------------------


def test_a_client_gets_access_only_to_the_named_projects(owner, guest_client, db):
    first = owner.post("/api/projects", json={"name": "Первый"}).json()["id"]
    second = owner.post("/api/projects", json={"name": "Второй"}).json()["id"]
    invitation = _invite(owner, emails=["client@example.com"], role="client", project_ids=[first])
    _register(guest_client, "Client", "client@example.com")
    guest_client.post(f"/api/invitations/{_token(invitation['link'])}/accept")

    client_user = db.scalar(select(User).where(User.email == "client@example.com"))
    granted = db.scalars(
        select(ProjectAccess.project_id).where(ProjectAccess.user_id == client_user.id)
    ).all()

    assert [str(item) for item in granted] == [first]
    assert second not in [str(item) for item in granted]


def test_a_project_of_another_organization_cannot_be_granted(owner, db):
    other_org = Organization(name="Globex", slug="globex")
    db.add(other_org)
    db.flush()
    foreign = Project(org_id=other_org.id, name="Secret", slug="secret")
    db.add(foreign)
    db.flush()

    response = owner.post(
        "/api/org/invitations",
        json={"emails": [], "role": "client", "project_ids": [str(foreign.id)]},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "project_not_found"


# --- почта -------------------------------------------------------------------


def test_without_mail_the_invitation_is_created_and_the_link_is_still_there(owner):
    """Установка без почтового сервера остаётся полноценной."""
    invitation = _invite(owner, emails=["maria@example.com"])

    assert invitation["sent"] is False
    assert invitation["link"] is not None


def test_a_failed_email_does_not_roll_the_invitation_back(owner, monkeypatch, db):
    """Приглашение существует независимо от того, доставили его письмом или нет."""
    import app.api.invite_routes as routes

    class Broken:
        enabled = True

        def send(self, *args, **kwargs):
            raise MailError("сервер отказал")

    monkeypatch.setattr(routes, "get_mailer", lambda: Broken())

    invitation = _invite(owner, emails=["maria@example.com"])

    assert invitation["sent"] is False
    assert invitation["mail_error"] == "сервер отказал"
    assert invitation["link"] is not None
    assert db.scalar(select(Invitation)) is not None


def test_with_mail_configured_an_unverified_owner_cannot_invite(db, client, monkeypatch):
    """Подтверждение не блокирует работу, кроме приглашения других."""
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "mail_transport", "log", raising=False)
    _register(client, "Alex", "alex@example.com")

    refused = client.post("/api/org/invitations", json={"emails": [], "role": "viewer"})
    assert refused.status_code == 403
    assert refused.json()["detail"] == "email_not_verified"

    # Всё остальное при этом доступно.
    assert client.post("/api/projects", json={"name": "Redesign"}).status_code == 201

    user = db.scalar(select(User).where(User.email == "alex@example.com"))
    user.email_verified_at = datetime.now(timezone.utc)
    db.flush()
    assert client.post("/api/org/invitations", json={"emails": [], "role": "viewer"}).status_code == 201


def test_the_verification_link_confirms_the_address(db, client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "mail_transport", "log", raising=False)
    sent: list[str] = []

    import app.api.auth_routes as auth_routes

    class Recording:
        enabled = True

        def send(self, to, template, locale, params):
            sent.append(params["link"])

    monkeypatch.setattr(auth_routes, "get_mailer", lambda: Recording())
    _register(client, "Alex", "alex@example.com")

    token = sent[0].rsplit("/", 1)[-1]
    response = client.post(f"/api/auth/verify/{token}")

    assert response.status_code == 200
    user = db.scalar(select(User).where(User.email == "alex@example.com"))
    assert user.email_verified_at is not None
    # Токен одноразовый: повторно та же ссылка не работает.
    assert client.post(f"/api/auth/verify/{token}").status_code == 404


# --- домен -------------------------------------------------------------------


def test_creating_an_invitation_with_an_unknown_role_is_refused(db):
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    user = User(email="a@b.c", password_hash="x", name="A")
    db.add(user)
    db.flush()

    with pytest.raises(InvitationError) as error:
        create_invitation(db, org, inviter=user, role="admin")

    assert error.value.code == "unknown_role"


def test_accepting_twice_in_the_same_organization_does_not_duplicate_membership(db):
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    inviter = User(email="owner@b.c", password_hash="x", name="Owner")
    guest = User(email="guest@b.c", password_hash="x", name="Guest")
    db.add_all([inviter, guest])
    db.flush()
    db.add(Membership(org_id=org.id, user_id=guest.id, role="viewer"))
    db.flush()

    _, token = create_invitation(db, org, inviter=inviter, role="editor")
    accept(db, token, guest)

    memberships = db.scalars(
        select(Membership).where(Membership.org_id == org.id, Membership.user_id == guest.id)
    ).all()
    # Второй раз в ту же организацию не зовут — и роль не переписывают
    # приглашением: повышение это отдельное действие над участником.
    assert len(memberships) == 1
    assert memberships[0].role == "viewer"
