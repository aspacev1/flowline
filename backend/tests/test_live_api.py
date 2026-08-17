from contextlib import nullcontext

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.live_routes import CLOSE_NOT_FOUND, CLOSE_UNAUTHENTICATED, db_scope
from app.db import get_db
from app.main import app


@pytest.fixture
def client(db):
    """TestClient в режиме контекстного менеджера — и это здесь обязательно.

    Без `with` TestClient заводит свой цикл событий на каждый запрос, и сокет
    оказывается в одном цикле, а фоновая задача маршрута мутаций — в другом.
    Рассылка тогда кладёт сообщение в очередь чужого цикла из чужого потока и
    не будит его: тест зависает на ровном месте.

    `db_scope` подменяется на ту же сессию, что и `get_db`: сокет закрывает
    свою сессию сам, а закрытая сессия фикстуры откатила бы транзакцию теста
    вместе со всем, что тест успел создать.
    """

    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[db_scope] = lambda: (lambda: nullcontext(db))
    try:
        with TestClient(app) as instance:
            yield instance
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(db_scope, None)


@pytest.fixture
def authed(client):
    client.post(
        "/api/auth/register",
        json={
            "name": "Alex",
            "email": "alex@example.com",
            "password": "s3cret-pass",
            "company_name": "Acme",
        },
    )
    return client


@pytest.fixture
def project_id(authed):
    return authed.post("/api/projects", json={"name": "Redesign"}).json()["id"]


def make_category(client, project_id, name="Design"):
    return client.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "create_category", "name": name, "color": "#3b82f6"}},
    ).json()["op"]["category_id"]


def refusal_code(client, project_id) -> int:
    """Код, которым сервер закрыл сокет.

    Отказ приходит уже после принятия — только так браузер узнаёт код, а не
    видит одинаковое «рукопожатие не состоялось» на все случаи жизни.
    """
    with client.websocket_connect(f"/api/projects/{project_id}/live") as socket:
        with pytest.raises(WebSocketDisconnect) as refusal:
            socket.receive_json()
    return refusal.value.code


def test_a_mutation_reaches_a_connected_client(authed, project_id):
    with authed.websocket_connect(f"/api/projects/{project_id}/live") as socket:
        make_category(authed, project_id, "Design")

        event = socket.receive_json()
        assert event["type"] == "revision"
        assert event["seq"] == 1
        assert event["op"]["type"] == "create_category"
        assert event["op"]["name"] == "Design"
        assert event["actor"]["name"] == "Alex"


def test_every_listener_of_the_project_gets_the_revision(authed, project_id):
    """Двух подключений мало для «рассылки», если проверять одно из них."""
    with (
        authed.websocket_connect(f"/api/projects/{project_id}/live") as first,
        authed.websocket_connect(f"/api/projects/{project_id}/live") as second,
    ):
        make_category(authed, project_id)

        assert first.receive_json()["op"]["type"] == "create_category"
        assert second.receive_json()["op"]["type"] == "create_category"


def test_a_change_in_another_project_does_not_reach_this_socket(authed, project_id):
    other = authed.post("/api/projects", json={"name": "Другой"}).json()["id"]

    with authed.websocket_connect(f"/api/projects/{other}/live") as socket:
        make_category(authed, project_id, "Чужая")
        # Сообщение о своём проекте приходит следом: без него тест не отличал
        # бы «не прислали чужое» от «не прислали ничего вообще».
        make_category(authed, other, "Своя")

        event = socket.receive_json()
        assert event["op"]["name"] == "Своя"


def test_the_event_carries_the_reason_as_written(authed, project_id):
    category_id = make_category(authed, project_id)
    task_id = authed.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "create_task",
                "category_id": category_id,
                "name": "Logo",
                "start_date": "2026-03-06",
                "duration_days": 3,
            }
        },
    ).json()["op"]["task_id"]

    with authed.websocket_connect(f"/api/projects/{project_id}/live") as socket:
        authed.post(
            f"/api/projects/{project_id}/mutations",
            json={
                "op": {"type": "move_task", "task_id": task_id, "start_date": "2026-03-13"},
                "reason": "заказчик не прислал брендбук",
            },
        )

        event = socket.receive_json()
        assert event["reason"] == "заказчик не прислал брендбук"
        assert event["op"]["type"] == "move_task"


def test_the_socket_reminds_of_itself_while_the_project_is_quiet(authed, project_id, monkeypatch):
    """Молчащий сокет и оборванный сокет обязаны различаться.

    Без этого напоминания клиент не может отличить «в проекте ничего не
    происходит» от «связи давно нет»: у половины обрывов (уснувший ноутбук,
    сменившаяся сеть) закрытия соединения не случается вовсе.
    """
    import app.api.live_routes as live_routes

    monkeypatch.setattr(live_routes, "HEARTBEAT_SECONDS", 0.05)

    with authed.websocket_connect(f"/api/projects/{project_id}/live") as socket:
        assert socket.receive_json() == {"type": "heartbeat"}


def test_the_socket_does_not_take_orders(authed, project_id):
    """Слушающий сокет — только слушающий.

    Единственная дорога изменения — POST мутации, где проверяется право.
    Присланное в сокет обязано быть выброшено, а не разобрано и применено.
    """
    with authed.websocket_connect(f"/api/projects/{project_id}/live") as socket:
        socket.send_json({"type": "create_category", "name": "Взлом", "color": "#000000"})
        make_category(authed, project_id, "Настоящая")

        event = socket.receive_json()
        assert event["op"]["name"] == "Настоящая"

    assert authed.get(f"/api/projects/{project_id}").json()["categories"] == [
        {
            "id": event["op"]["category_id"],
            "name": "Настоящая",
            "color": "#3b82f6",
            "position": 0,
        }
    ]


def test_the_revision_is_committed_before_it_is_broadcast(authed, project_id, db, monkeypatch):
    """Порядок «сначала в базу, потом в эфир» — не деталь реализации.

    Клиент на сигнал перезапрашивает проект целиком. Придя раньше коммита, он
    не увидел бы изменения, а второго сигнала не будет — экран остался бы
    устаревшим до следующей чужой правки.

    Проверяется именно порядок вызовов: сама рассылка в этот момент кладёт
    словарь в память, и «увидел бы или нет» из теста не наблюдаемо.
    """
    from app.live import hub

    order: list[str] = []
    real_commit = db.commit

    def recording_commit():
        order.append("commit")
        real_commit()

    async def recording_publish(project_id, message):
        order.append("publish")

    monkeypatch.setattr(db, "commit", recording_commit)
    monkeypatch.setattr(hub, "publish", recording_publish)

    make_category(authed, project_id)

    assert order == ["commit", "publish"]


def test_an_unauthenticated_socket_is_closed(client, db):
    from app.models import Organization, Project

    org = Organization(name="Globex", slug="globex")
    db.add(org)
    db.flush()
    project = Project(org_id=org.id, name="Secret", slug="secret")
    db.add(project)
    db.flush()

    assert refusal_code(client, project.id) == CLOSE_UNAUTHENTICATED


def test_a_project_of_another_organization_is_closed_as_missing(authed, db):
    """Чужой проект неотличим от несуществующего и здесь, а не только в HTTP."""
    from app.models import Organization, Project

    org = Organization(name="Globex", slug="globex")
    db.add(org)
    db.flush()
    project = Project(org_id=org.id, name="Secret", slug="secret")
    db.add(project)
    db.flush()

    assert refusal_code(authed, project.id) == CLOSE_NOT_FOUND

    missing = "00000000-0000-0000-0000-000000000000"
    assert refusal_code(authed, missing) == CLOSE_NOT_FOUND


def test_a_role_without_read_permission_is_closed_as_missing(authed, project_id, monkeypatch):
    """Роль без права читать проект не должна узнать, что он есть.

    Сегодня такую роль через сокет не воспроизвести: `client` и гость читают
    проект только по выданному гранту, а грантов ещё нет (план 5). Поэтому
    подменяется само решение — проверяется код маршрута, а не будущая
    инфраструктура грантов. Тот же приём, что и в test_project_api.
    """
    import app.api.live_routes as live_routes

    monkeypatch.setattr(live_routes, "can", lambda *args, **kwargs: False)

    assert refusal_code(authed, project_id) == CLOSE_NOT_FOUND


def test_the_internal_note_is_stripped_for_a_role_that_may_not_read_it(authed, project_id, monkeypatch):
    """Заметка не должна уезжать в сокет тому, кому её не показывают в HTTP.

    Право подменяется по той же причине, что и в тесте выше.
    """
    import app.access as access

    category_id = make_category(authed, project_id)
    real_can = access.can

    def fake_can(role, action, *, project_granted=False):
        if action is access.Action.READ_INTERNAL_NOTE:
            return False
        return real_can(role, action, project_granted=project_granted)

    with authed.websocket_connect(f"/api/projects/{project_id}/live") as socket:
        monkeypatch.setattr(access, "can", fake_can)
        authed.post(
            f"/api/projects/{project_id}/mutations",
            json={
                "op": {
                    "type": "create_task",
                    "category_id": category_id,
                    "name": "Logo",
                    "start_date": "2026-03-06",
                    "duration_days": 3,
                    "internal_note": "тайный план",
                }
            },
        )

        event = socket.receive_json()
        assert event["op"]["type"] == "create_task"
        assert "internal_note" not in event["op"]


# --- волна 2.10: Origin на рукопожатии ---------------------------------------


def test_a_socket_from_a_foreign_origin_is_refused(authed, project_id):
    """Кука уезжает с рукопожатием с любого сайта (SameSite=Lax считает его
    навигацией), и без проверки Origin чужая страница читала бы живую ленту
    от имени залогиненного посетителя."""
    with authed.websocket_connect(
        f"/api/projects/{project_id}/live", headers={"origin": "https://evil.example"}
    ) as socket:
        with pytest.raises(WebSocketDisconnect) as refusal:
            socket.receive_json()
    assert refusal.value.code == CLOSE_UNAUTHENTICATED


def test_a_socket_from_our_own_origin_connects(authed, project_id):
    with authed.websocket_connect(
        f"/api/projects/{project_id}/live", headers={"origin": "http://testserver"}
    ):
        pass  # рукопожатие состоялось — этого достаточно
