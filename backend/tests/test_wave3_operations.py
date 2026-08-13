"""Регрессионные тесты волны 3: доступность сервиса и эксплуатация.

Проверяемое здесь ломалось не у пользователя в браузере, а у того, кто
разворачивает и сопровождает установку: рассылка живой ленты, обходящая
половину пишущих маршрутов, зависшая на SMTP регистрация, requirements.txt,
уехавший от uv.lock, health, который зелёный при мёртвой базе.
"""

import re
import tomllib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app

REPO_ROOT = Path(__file__).resolve().parents[2]


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


# --- 3.4: живая лента накрывает все пишущие маршруты --------------------------


def test_every_writing_route_publishes_into_the_hub(authed, monkeypatch):
    """Отмена, откат пачки, настройки, план и комментарий — событие в комнату.

    До волны 3 публиковал только маршрут мутаций: соседние вкладки узнавали
    об отмене и новых настройках только перезагрузкой.
    """
    from app.api import project_routes

    published: list[dict] = []
    monkeypatch.setattr(
        project_routes.hub, "publish", lambda project_id, event: published.append(event)
    )
    # Коммит внутри _publish закрыл бы транзакцию тестовой сессии — а тест
    # живёт внутри неё. Публикацию это не задевает: она следующая строка.
    monkeypatch.setattr(project_routes, "_publish",
        lambda background, db, project_id, event: published.append(event))

    project_id = authed.post("/api/projects", json={"name": "Редизайн"}).json()["id"]
    authed.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "create_category", "name": "Дизайн", "color": "#3b82f6"}},
    )
    authed.post(f"/api/projects/{project_id}/undo", json={})
    authed.patch(f"/api/projects/{project_id}", json={"shift_threshold_days": 5})
    authed.post(f"/api/projects/{project_id}/plan/approvals")
    authed.post(f"/api/projects/{project_id}/comments", json={"body": "Реплика"})

    kinds = [event["type"] for event in published]
    # Мутация публикует своим, старым путём — здесь считаются новые четыре.
    assert kinds.count("revision") >= 3  # отмена, настройки, план
    assert "comment" in kinds


def test_the_comment_event_carries_no_text(authed, monkeypatch):
    """В комнате сидит и клиент: событие о реплике не смеет нести тело —
    внутреннюю реплику фильтрует HTTP-маршрут, а не сокет."""
    from app.api import project_routes

    published: list[dict] = []
    monkeypatch.setattr(project_routes, "_publish",
        lambda background, db, project_id, event: published.append(event))

    project_id = authed.post("/api/projects", json={"name": "Редизайн"}).json()["id"]
    authed.post(
        f"/api/projects/{project_id}/comments",
        json={"body": "Бюджет трещит", "internal": True},
    )

    comment_events = [e for e in published if e["type"] == "comment"]
    assert comment_events == [{"type": "comment"}]


# --- 3.6: наблюдаемость -------------------------------------------------------


def test_responses_carry_a_request_id(client):
    response = client.get("/api/health")
    assert response.headers.get("x-request-id")


def test_a_supplied_request_id_is_echoed_but_sanitised(client):
    response = client.get("/api/health", headers={"X-Request-ID": "abc-123"})
    assert response.headers["x-request-id"] == "abc-123"

    hostile = client.get("/api/health", headers={"X-Request-ID": "a\tb<evil>" + "x" * 200})
    echoed = hostile.headers["x-request-id"]
    assert len(echoed) <= 64
    assert re.fullmatch(r"[A-Za-z0-9_\-]+", echoed)


def test_readiness_asks_the_database(client, monkeypatch):
    assert client.get("/api/health/ready").json() == {"status": "ready"}

    import app.db as db_module

    class _DeadEngine:
        def connect(self):
            raise ConnectionError("база лежит")

    monkeypatch.setattr(db_module, "engine", _DeadEngine())
    assert client.get("/api/health/ready").status_code == 503
    # Liveness при этом остаётся зелёным: мёртвая база — не повод
    # перезапускать процесс.
    assert client.get("/api/health").status_code == 200


# --- 3.8: requirements.txt не расходится с uv.lock ----------------------------


def test_vercel_requirements_match_uv_lock():
    """requirements.txt (Vercel) закреплён по uv.lock — и это обещание из его
    же шапки. Расхождение означает, что бой собирается из других версий, чем
    локальная разработка и CI.
    """
    lock = tomllib.loads((REPO_ROOT / "backend" / "uv.lock").read_text())
    locked = {package["name"].lower(): package["version"] for package in lock["package"]}

    mismatches = []
    for line in (REPO_ROOT / "requirements.txt").read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"([A-Za-z0-9_.\[\]-]+)==([A-Za-z0-9_.]+)", line)
        assert match, f"строка не разбирается как пин: {line!r}"
        name = match.group(1).split("[")[0].lower().replace("_", "-")
        version = match.group(2)
        if locked.get(name) != version:
            mismatches.append(f"{name}: requirements.txt={version}, uv.lock={locked.get(name)}")

    assert mismatches == [], (
        "requirements.txt разошёлся с backend/uv.lock:\n" + "\n".join(mismatches)
    )


def test_the_config_route_names_live_availability(client):
    assert "live_enabled" in client.get("/api/config").json()
