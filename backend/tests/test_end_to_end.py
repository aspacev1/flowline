"""Сквозной сценарий — пункт 11 раздела 13.

Создать проект через интервью, утвердить план, сдвинуть задачу с причиной,
открыть публичную ссылку в другом браузере, убедиться, что видны диаграмма и
комментарии, но не внутренние заметки.

Тест намеренно один и длинный: он проверяет не отдельные правила, а то, что
они складываются в работающий продукт. Разбитый на восемь маленьких, он
перестал бы отвечать на единственный вопрос, ради которого написан.
"""

import pytest
from fastapi.testclient import TestClient

from app.ai.provider import RecordedProvider
from app.db import get_db
from app.main import app

QUESTION = {"question": "Какой результат считается успехом?", "covered_topics": ["goal"]}
SUMMARY = {"theses": ["Сайт-визитка к июню", "Дизайн делает подрядчик"]}
DRAFT = {
    "categories": [
        {
            "name": "Дизайн",
            "tasks": [
                {
                    "name": "Логотип",
                    "description": "Знак и написание",
                    "start_date": "2026-03-02",
                    "duration_days": 5,
                    "criticality": "high",
                }
            ],
        }
    ]
}


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
def guest(db):
    """Другой браузер: своя сессия, свой клиент, тот же сервер."""

    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_the_whole_way_from_interview_to_the_public_link(client, guest, db, monkeypatch):
    import app.api.ai_routes as ai_routes
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "ai_max_questions", 1, raising=False)
    provider = RecordedProvider([QUESTION, SUMMARY, DRAFT])
    monkeypatch.setattr(ai_routes, "provider_for", lambda db, org: provider)

    # 1. Человек регистрируется и оказывается внутри со своей организацией.
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
        headers={"Accept-Language": "ru-RU,ru;q=0.9"},
    )
    assert client.get("/api/auth/me").json()["locale"] == "ru"

    # 2. Проект собирается через интервью: вопрос, ответ, конспект, черновик.
    session_id = client.post("/api/ai/sessions", json={"locale": "ru"}).json()["id"]
    client.post(f"/api/ai/sessions/{session_id}/answers", json={"text": "Сайт-визитка к июню"})
    client.post(f"/api/ai/sessions/{session_id}/summary")
    client.post(f"/api/ai/sessions/{session_id}/draft")

    applied = client.post(f"/api/ai/sessions/{session_id}/apply", json={"name": "Сайт"})
    assert applied.status_code == 201
    project_id = applied.json()["project_id"]

    state = client.get(f"/api/projects/{project_id}").json()
    task_id = state["tasks"][0]["id"]
    assert state["categories"][0]["name"] == "Дизайн"

    # 3. Внутренняя заметка — та, которую гость не должен увидеть ни при каких
    # обстоятельствах.
    client.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {
                "type": "set_task_fields",
                "task_id": task_id,
                "name": "Логотип",
                "description": "Знак и написание",
                "internal_note": "подрядчик просит предоплату",
            }
        },
    )

    # 4. План утверждается: снимок дат ложится в базовый план.
    assert client.post(f"/api/projects/{project_id}/plan/approvals").status_code == 201
    approved = client.get(f"/api/projects/{project_id}").json()
    assert approved["tasks"][0]["baseline_start"] == "2026-03-02"

    # 5. Сдвиг за порог без причины отбивается…
    refused = client.post(
        f"/api/projects/{project_id}/mutations",
        json={"op": {"type": "move_task", "task_id": task_id, "start_date": "2026-03-16"}},
    )
    assert refused.status_code == 409
    assert refused.json()["detail"] == "reason_required"

    # …и проходит с причиной, которая остаётся в истории задачи как есть.
    client.post(
        f"/api/projects/{project_id}/mutations",
        json={
            "op": {"type": "move_task", "task_id": task_id, "start_date": "2026-03-16"},
            "reason": "заказчик не прислал брендбук",
        },
    )
    history = client.get(f"/api/projects/{project_id}/revisions?task_id={task_id}").json()
    assert history[0]["reason"] == "заказчик не прислал брендбук"

    # 6. Владелец выпускает публичную ссылку.
    share = client.post(f"/api/projects/{project_id}/share", json={}).json()
    token = share["url"].split("s=")[-1]
    assert f"/p/" in share["url"]

    # 7. Другой браузер, без всякой сессии: диаграмма видна.
    public = guest.get(f"/api/public/{token}")
    assert public.status_code == 200
    page = public.json()
    assert page["name"] == "Сайт"
    assert page["tasks"][0]["start_date"] == "2026-03-16"
    # Базовый план виден и гостю: призрак под полоской и есть ответ на вопрос
    # «а когда обещали».
    assert page["tasks"][0]["baseline_start"] == "2026-03-02"
    # А внутренней заметки нет ни в одном поле ответа.
    assert "internal_note" not in page["tasks"][0]
    assert "подрядчик просит предоплату" not in public.text
    # И отменять гостю нечего: кнопка отмены ему не показывается.
    assert page["undoable"] is None

    # 8. Гость комментирует, назвавшись именем; его реплика отличается от
    # реплики участника.
    client.post(
        f"/api/projects/{project_id}/comments",
        json={"body": "Держим сроки", "task_id": task_id},
    )
    posted = guest.post(
        f"/api/public/{token}/comments",
        json={"body": "А успеем до июня?", "guest_name": "Мария"},
    )
    assert posted.status_code == 201
    assert posted.json()["author_name"] == "Мария"
    assert posted.json()["is_guest"] is True

    comments = guest.get(f"/api/public/{token}/comments").json()
    assert [(item["author_name"], item["is_guest"]) for item in comments] == [
        ("Alex", False),
        ("Мария", True),
    ]

    # 9. Перевыпуск ссылки убивает прежнюю мгновенно.
    fresh = client.post(f"/api/projects/{project_id}/share", json={}).json()
    assert guest.get(f"/api/public/{token}").status_code == 404
    assert guest.get(f"/api/public/{fresh['url'].split('s=')[-1]}").status_code == 200


def test_a_guest_cannot_comment_when_comments_are_off(client, guest, db):
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    project_id = client.post("/api/projects", json={"name": "Сайт"}).json()["id"]
    share = client.post(
        f"/api/projects/{project_id}/share", json={"comments_enabled": False}
    ).json()
    token = share["url"].split("s=")[-1]

    refused = guest.post(
        f"/api/public/{token}/comments", json={"body": "привет", "guest_name": "Мария"}
    )

    assert refused.status_code == 403
    assert refused.json()["detail"] == "comments_disabled"
    # Читать проект при этом можно: выключены комментарии, а не ссылка.
    assert guest.get(f"/api/public/{token}").status_code == 200


def test_a_guest_must_name_themselves(client, guest, db):
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    project_id = client.post("/api/projects", json={"name": "Сайт"}).json()["id"]
    token = client.post(f"/api/projects/{project_id}/share", json={}).json()["url"].split("s=")[-1]

    refused = guest.post(f"/api/public/{token}/comments", json={"body": "привет"})

    assert refused.status_code == 422
    assert refused.json()["detail"] == "guest_name_required"


def test_a_revoked_link_is_indistinguishable_from_a_missing_one(client, guest, db):
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    project_id = client.post("/api/projects", json={"name": "Сайт"}).json()["id"]
    token = client.post(f"/api/projects/{project_id}/share", json={}).json()["url"].split("s=")[-1]

    client.delete(f"/api/projects/{project_id}/share")

    revoked = guest.get(f"/api/public/{token}")
    missing = guest.get("/api/public/nonexistent-token")
    # Разница между ними была бы подсказкой тому, кто перебирает токены.
    assert revoked.status_code == missing.status_code == 404
    assert revoked.json() == missing.json()


def test_public_sharing_can_be_switched_off_by_the_organization(client, db):
    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    project_id = client.post("/api/projects", json={"name": "Сайт"}).json()["id"]
    client.patch("/api/org", json={"public_sharing_enabled": False})

    refused = client.post(f"/api/projects/{project_id}/share", json={})

    assert refused.status_code == 403
    assert refused.json()["detail"] == "public_sharing_disabled"


def test_the_guest_comment_rate_limit_bites(client, guest, db, monkeypatch):
    from app.api import public_routes
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "guest_comment_rate_limit", 2, raising=False)
    # Счётчик живёт в памяти процесса и переживает тесты: соседний тест не
    # должен решать судьбу этого.
    public_routes._GUEST_HITS.clear()

    client.post(
        "/api/auth/register",
        json={"name": "Alex", "email": "alex@example.com", "password": "s3cret-pass"},
    )
    project_id = client.post("/api/projects", json={"name": "Сайт"}).json()["id"]
    token = client.post(f"/api/projects/{project_id}/share", json={}).json()["url"].split("s=")[-1]

    body = {"body": "привет", "guest_name": "Мария"}
    assert guest.post(f"/api/public/{token}/comments", json=body).status_code == 201
    assert guest.post(f"/api/public/{token}/comments", json=body).status_code == 201
    third = guest.post(f"/api/public/{token}/comments", json=body)

    assert third.status_code == 429
    assert third.json()["detail"] == "comment_rate_limited"
