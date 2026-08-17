from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import get_db
from app.main import app


@pytest.fixture
def client(db):
    """Тот же паттерн, что в tests/test_project_api.py: get_db отдаёт сессию
    фикстуры `db` и не делает commit, иначе внешняя транзакция закроется
    раньше времени и изоляция между тестами исчезнет."""

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
def clients(db):
    """Фабрика клиентов поверх одной сессии базы — как в tests/test_invite_api.py.

    Управление составом требует двоих: один правит роль, второго правят. У
    каждого своя кука, а сессия базы общая, иначе второй не увидел бы
    организацию первого.
    """

    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield lambda: TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_current_organization_is_named(authed):
    """Шапка интерфейса подписана названием организации, и взять его больше
    неоткуда: состав участников про саму организацию ничего не говорит."""
    response = authed.get("/api/org")
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Alex"
    assert body["slug"] == "alex"
    assert body["role"] == "owner"


def test_current_organization_requires_authentication(client):
    assert client.get("/api/org").status_code == 401


def test_a_client_still_knows_which_organization_they_are_in(authed, db):
    """В отличие от состава участников, само название организации от её
    участника не скрывается: он видит его в шапке на каждом экране, и роль
    `client` здесь ничего не меняет."""
    from app.models import Membership

    user_id = authed.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
    membership.role = "client"
    db.flush()

    response = authed.get("/api/org")
    assert response.status_code == 200
    assert response.json()["role"] == "client"


def test_members_lists_only_this_organization(authed, db):
    from app.auth import register

    register(db, name="Stranger", email="stranger@example.com", password="s3cret-pass")
    db.flush()

    response = authed.get("/api/org/members")
    assert response.status_code == 200
    emails = [m["email"] for m in response.json()]
    assert "stranger@example.com" not in emails


def test_members_requires_authentication(client):
    assert client.get("/api/org/members").status_code == 401


def test_members_returns_id_name_email_and_role(authed):
    response = authed.get("/api/org/members")
    assert response.status_code == 200
    [me] = response.json()
    assert me["name"] == "Alex"
    assert me["email"] == "alex@example.com"
    assert me["role"] == "owner"
    assert me["id"] == authed.get("/api/auth/me").json()["id"]


def test_a_client_does_not_see_the_organization_roster(authed, db):
    """По спеку роль client состава организации не видит вовсе.

    Здесь 403, а не 404: маршрут не про конкретный проект, и скрывать факт
    существования собственной организации от её же участника нечего.
    """
    from app.models import Membership

    user_id = authed.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == user_id))
    membership.role = "client"
    db.flush()

    assert authed.get("/api/org/members").status_code == 403


# ---- управление составом: роли и вывод из организации ----------------------


def _register(client, name, email):
    return client.post(
        "/api/auth/register",
        json={"name": name, "email": email, "password": "s3cret-pass"},
    )


@pytest.fixture
def pair(clients, db):
    """Владелец организации и второй человек в ней. Роль второго — `viewer`.

    Второй заводится обычной регистрацией (со своей организацией, как у всех,
    кто пришёл с улицы), а членство в чужой добавляется записью: путь через
    приглашение проверяется в tests/test_invite_api.py, и повторять его здесь
    значило бы проверять приглашения ещё раз, а не состав.
    """
    from app.models import Membership as MembershipModel

    owner = clients()
    _register(owner, "Alex", "alex@example.com")
    org_id = owner.get("/api/org").json()["id"]

    other = clients()
    _register(other, "Maria", "maria@example.com")
    other_id = other.get("/api/auth/me").json()["id"]

    db.add(MembershipModel(org_id=org_id, user_id=other_id, role="viewer"))
    db.flush()
    other.post("/api/org/switch", json={"org_id": org_id})
    return owner, other, other_id


def _role_of(client, user_id):
    roster = {member["id"]: member["role"] for member in client.get("/api/org/members").json()}
    return roster.get(user_id)


def test_an_owner_changes_the_role_of_a_member(pair):
    owner, _, other_id = pair

    response = owner.patch(f"/api/org/members/{other_id}", json={"role": "editor"})

    assert response.status_code == 200
    assert response.json()["role"] == "editor"
    assert response.json()["email"] == "maria@example.com"
    assert _role_of(owner, other_id) == "editor"


def test_the_owner_role_is_handed_over_by_this_route_and_not_by_an_invitation(pair):
    """Владельца назначают именно здесь — то самое «отдельное действие».

    Приглашением эта роль не выдаётся (`role_not_invitable`): ссылка без
    адреса достаётся предъявителю. Здесь адресат назван поимённо.
    """
    owner, other, other_id = pair

    assert owner.patch(f"/api/org/members/{other_id}", json={"role": "owner"}).status_code == 200
    # Право проверяется по делу, а не по ответу маршрута: новый владелец
    # правит настройки организации, а `viewer` не правил.
    assert other.patch("/api/org", json={"name": "Globex"}).status_code == 200


def test_the_last_owner_is_not_demoted(authed, db):
    """Организация без владельца заперта навсегда: назначить нового некому."""
    user_id = authed.get("/api/auth/me").json()["id"]

    response = authed.patch(f"/api/org/members/{user_id}", json={"role": "editor"})

    assert response.status_code == 409
    assert response.json()["detail"] == "last_owner"
    assert _role_of(authed, user_id) == "owner"


def test_an_owner_steps_down_once_there_is_a_second_one(pair):
    owner, _, other_id = pair
    owner_id = owner.get("/api/auth/me").json()["id"]
    owner.patch(f"/api/org/members/{other_id}", json={"role": "owner"})

    assert owner.patch(f"/api/org/members/{owner_id}", json={"role": "editor"}).status_code == 200


def test_naming_the_role_a_member_already_has_is_not_an_error(authed):
    """Владелец, «назначенный» владельцем, — не попытка остаться без владельца.

    Иначе защита последнего срабатывала бы на запросе, который ничего не
    меняет: интерфейс отправляет выбранное значение, а не разницу с прежним.
    """
    user_id = authed.get("/api/auth/me").json()["id"]

    assert authed.patch(f"/api/org/members/{user_id}", json={"role": "owner"}).status_code == 200


def test_an_unknown_role_is_refused_with_its_own_code(pair):
    owner, _, other_id = pair

    response = owner.patch(f"/api/org/members/{other_id}", json={"role": "superuser"})

    assert response.status_code == 422
    assert response.json()["detail"] == "unknown_role"


def test_a_person_from_another_organization_is_simply_not_found(authed, db):
    """404, а не 403: иначе перебор по адресу называет чужих пользователей."""
    from app.auth import register

    stranger = register(db, name="Stranger", email="stranger@example.com", password="s3cret-pass")
    db.flush()

    response = authed.patch(f"/api/org/members/{stranger.id}", json={"role": "editor"})

    assert response.status_code == 404
    assert response.json()["detail"] == "member_not_found"


def test_only_an_owner_changes_roles(pair):
    _, other, other_id = pair

    assert other.patch(f"/api/org/members/{other_id}", json={"role": "editor"}).status_code == 403


def test_an_owner_removes_a_member(pair):
    owner, _, other_id = pair

    assert owner.delete(f"/api/org/members/{other_id}").status_code == 204
    assert _role_of(owner, other_id) is None


def test_a_member_does_not_remove_anyone_but_themselves(pair, clients, db):
    from app.models import Membership as MembershipModel

    owner, other, _ = pair
    owner_id = owner.get("/api/auth/me").json()["id"]
    org_id = owner.get("/api/org").json()["id"]

    third = clients()
    _register(third, "Nadir", "nadir@example.com")
    third_id = third.get("/api/auth/me").json()["id"]
    db.add(MembershipModel(org_id=org_id, user_id=third_id, role="viewer"))
    db.flush()

    assert other.delete(f"/api/org/members/{owner_id}").status_code == 403
    assert other.delete(f"/api/org/members/{third_id}").status_code == 403


def test_anyone_may_leave_on_their_own(pair):
    """Уход своими руками прав в организации не требует.

    Проверяется на роли `client`: она не видит даже состава организации, и
    если бы «выйти» требовало права, позванный однажды остался бы внутри
    навсегда.
    """
    owner, other, other_id = pair
    owner.patch(f"/api/org/members/{other_id}", json={"role": "client"})

    assert other.delete(f"/api/org/members/{other_id}").status_code == 204
    assert _role_of(owner, other_id) is None


def test_the_last_owner_does_not_leave_either(authed):
    """Та же защита, что и у разжалования: уйти последним владельцем нельзя."""
    user_id = authed.get("/api/auth/me").json()["id"]

    response = authed.delete(f"/api/org/members/{user_id}")

    assert response.status_code == 409
    assert response.json()["detail"] == "last_owner"


def test_leaving_takes_named_project_access_with_it(pair, db):
    """Поимённые доступы уходят вместе с членством.

    Иначе позванный обратно молча видел бы всё, что видел прежде, — доступ,
    который никто не выдавал заново.
    """
    from app.models import ProjectAccess
    from app.projects import create_project

    owner, other, other_id = pair
    org_id = owner.get("/api/org").json()["id"]
    project = create_project(db, org_id=org_id, name="Redesign")
    db.flush()
    db.add(ProjectAccess(project_id=project.id, user_id=other_id))
    db.flush()

    assert other.delete(f"/api/org/members/{other_id}").status_code == 204
    assert db.scalars(
        select(ProjectAccess).where(ProjectAccess.user_id == other_id)
    ).all() == []


def test_leaving_does_not_erase_the_person_from_the_plan(pair, db):
    """Назначения на задачи остаются: план не переписывается кадровым решением.

    Снять назначение с ушедшего можно и потом — отдельным действием, которое
    для того и не проверяет членства (см. UnassignUser в app.mutations).
    """
    from app.models import Category, Task, TaskAssignee
    from app.projects import create_project

    owner, other, other_id = pair
    org_id = owner.get("/api/org").json()["id"]
    project = create_project(db, org_id=org_id, name="Redesign")
    db.flush()
    category = Category(project_id=project.id, name="Design", color="#3b82f6", position=0)
    db.add(category)
    db.flush()
    task = Task(
        project_id=project.id,
        category_id=category.id,
        name="Смета",
        start_date=date(2026, 8, 17),
        duration_days=1,
        position=0,
    )
    db.add(task)
    db.flush()
    db.add(TaskAssignee(task_id=task.id, user_id=other_id))
    db.flush()

    other.delete(f"/api/org/members/{other_id}")

    assert db.scalars(select(TaskAssignee).where(TaskAssignee.user_id == other_id)).all() != []


def test_the_organization_left_behind_stops_being_the_active_one(pair, db):
    """Сессия ушедшего перестаёт указывать на чужое место.

    Отказом это не оборачивалось бы и без сброса — активное членство берётся
    первое доступное, — но указатель на организацию, в которую человек больше
    не входит, лучше убрать сразу.
    """
    from app.models import Session as SessionModel

    _, other, other_id = pair
    assert db.scalars(
        select(SessionModel.active_org_id).where(SessionModel.user_id == other_id)
    ).all() != [None]

    other.delete(f"/api/org/members/{other_id}")

    assert set(
        db.scalars(select(SessionModel.active_org_id).where(SessionModel.user_id == other_id)).all()
    ) == {None}
    # Своя организация никуда не делась — человек возвращается в неё.
    assert other.get("/api/org").json()["name"] == "Maria"


def test_managing_members_requires_authentication(client):
    someone = "00000000-0000-0000-0000-000000000001"
    assert client.patch(f"/api/org/members/{someone}", json={"role": "editor"}).status_code == 401
    assert client.delete(f"/api/org/members/{someone}").status_code == 401
