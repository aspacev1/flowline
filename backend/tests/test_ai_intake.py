"""AI-интейк — пункт 10 раздела 13.

На записанных ответах модели, без сети: валидная схема применяется, битая
отбивается и не роняет сессию. `RecordedProvider` — не заглушка «чтобы
компилировалось», а полноправная реализация того же интерфейса, что и боевой
провайдер.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.ai import intake
from app.ai.provider import LlmError, RecordedProvider
from app.crypto import decrypt
from app.db import get_db
from app.main import app
from app.models import AiSession, Category, Membership, Organization, OrgLlmCredential, Task, User


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
def org(db, authed) -> Organization:
    user_id = authed.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == uuid.UUID(user_id)))
    return db.get(Organization, membership.org_id)


@pytest.fixture
def user(db, authed) -> User:
    return db.scalar(select(User).where(User.email == "alex@example.com"))


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
        },
        {
            "name": "Разработка",
            "tasks": [
                {"name": "Вёрстка", "start_date": "2026-03-09", "duration_days": 10}
            ],
        },
    ]
}
BROKEN_DRAFT = {"categories": [{"name": "Дизайн", "tasks": [{"name": "Логотип"}]}]}


def _interview(db, org, user, provider) -> AiSession:
    return intake.start(db, org=org, user=user, locale="ru", provider=provider)


# --- интервью ----------------------------------------------------------------


def test_the_interview_asks_one_question_at_a_time(db, org, user):
    provider = RecordedProvider([QUESTION, {"question": "Кто участвует?", "covered_topics": []}])

    session = _interview(db, org, user, provider)

    assert session.status == "interview"
    assert [turn["question"] for turn in session.transcript] == [QUESTION["question"]]

    intake.answer(db, session, "Сайт-визитка", provider)
    assert session.transcript[0]["answer"] == "Сайт-визитка"
    assert len(session.transcript) == 2


def test_the_language_of_the_session_goes_into_the_prompt(db, org, user):
    """Язык передаётся явным параметром, а не угадывается по тексту ответов."""
    provider = RecordedProvider([QUESTION])

    intake.start(db, org=org, user=user, locale="az", provider=provider)

    system = provider.calls[0][0]
    assert system["role"] == "system"
    assert "az" in system["content"]


def test_the_interview_stops_at_the_ceiling(db, org, user, monkeypatch):
    """Жёсткий потолок вопросов: без него модель уточняет бесконечно."""
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "ai_max_questions", 2, raising=False)
    provider = RecordedProvider([QUESTION, QUESTION, QUESTION])
    session = _interview(db, org, user, provider)

    assert intake.answer(db, session, "первый ответ", provider) is not None
    # Второй ответ упирается в потолок: следующего вопроса нет, пора к
    # конспекту.
    assert intake.answer(db, session, "второй ответ", provider) is None
    assert len(session.transcript) == 2


def test_tokens_are_counted_per_session(db, org, user):
    provider = RecordedProvider([QUESTION, QUESTION], tokens=42)
    session = _interview(db, org, user, provider)

    intake.answer(db, session, "ответ", provider)

    assert session.tokens_used == 84


# --- ворота ------------------------------------------------------------------


def test_the_summary_is_a_gate_and_is_editable(db, org, user):
    provider = RecordedProvider([QUESTION, SUMMARY])
    session = _interview(db, org, user, provider)

    theses = intake.make_summary(db, session, provider)

    assert theses == SUMMARY["theses"]
    assert session.status == "summary"

    edited = intake.edit_summary(db, session, ["Сайт-визитка к июню", "  ", "Домен уже куплен"])
    # Пустые тезисы отбрасываются: правка на то и правка, что тезис удаляют
    # стиранием текста, а не отдельной кнопкой.
    assert edited == ["Сайт-визитка к июню", "Домен уже куплен"]


def test_a_valid_draft_is_accepted(db, org, user):
    provider = RecordedProvider([QUESTION, SUMMARY, DRAFT])
    session = _interview(db, org, user, provider)
    intake.make_summary(db, session, provider)

    draft = intake.make_draft(db, session, provider)

    assert session.status == "draft"
    assert [category["name"] for category in draft["categories"]] == ["Дизайн", "Разработка"]
    # В проект при этом не записано ничего: черновик живёт в сессии.
    assert session.project_id is None


def test_a_broken_draft_is_retried_and_then_refused_without_killing_the_session(
    db, org, user, monkeypatch
):
    """Битая схема отбивается и не роняет сессию.

    Переписка и конспект остаются на месте, статус не меняется — сессия
    продолжается с того же места, и повторить можно тем же запросом.
    """
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "ai_schema_retries", 2, raising=False)
    provider = RecordedProvider([QUESTION, SUMMARY, BROKEN_DRAFT, BROKEN_DRAFT, BROKEN_DRAFT])
    session = _interview(db, org, user, provider)
    intake.make_summary(db, session, provider)

    with pytest.raises(LlmError) as error:
        intake.make_draft(db, session, provider)

    assert error.value.code == "llm_schema_mismatch"
    # Три попытки: первая плюс два повтора.
    assert len(provider.calls) == 5
    assert session.status == "summary"
    assert session.summary == SUMMARY["theses"]
    assert session.transcript


def test_a_retry_succeeds_after_one_broken_answer(db, org, user):
    provider = RecordedProvider([QUESTION, SUMMARY, BROKEN_DRAFT, DRAFT])
    session = _interview(db, org, user, provider)
    intake.make_summary(db, session, provider)

    draft = intake.make_draft(db, session, provider)

    assert len(draft["categories"]) == 2


def test_an_unreachable_model_is_not_retried(db, org, user):
    """Повтор только на битой схеме.

    Недоступная сеть от повтора не починится, а расход токенов утроится.
    """
    provider = RecordedProvider(
        [QUESTION, SUMMARY, LlmError("llm_unreachable", "сеть недоступна")]
    )
    session = _interview(db, org, user, provider)
    intake.make_summary(db, session, provider)

    with pytest.raises(LlmError) as error:
        intake.make_draft(db, session, provider)

    assert error.value.code == "llm_unreachable"
    assert len(provider.calls) == 3


def test_a_draft_edited_by_hand_is_validated_the_same_way(db, org, user):
    provider = RecordedProvider([QUESTION, SUMMARY, DRAFT])
    session = _interview(db, org, user, provider)
    intake.make_summary(db, session, provider)
    intake.make_draft(db, session, provider)

    with pytest.raises(LlmError):
        intake.edit_draft(db, session, BROKEN_DRAFT)

    # Прежний черновик уцелел: отвергнутая правка ничего не стёрла.
    assert len(session.draft["categories"]) == 2


# --- применение --------------------------------------------------------------


def test_applying_writes_the_project_as_one_batch(db, org, user):
    provider = RecordedProvider([QUESTION, SUMMARY, DRAFT])
    session = _interview(db, org, user, provider)
    intake.make_summary(db, session, provider)
    intake.make_draft(db, session, provider)

    project, batch_id = intake.apply_draft(db, session, name="Сайт", actor=user)

    categories = db.scalars(select(Category).where(Category.project_id == project.id)).all()
    tasks = db.scalars(select(Task).where(Task.project_id == project.id)).all()
    assert sorted(category.name for category in categories) == ["Дизайн", "Разработка"]
    assert sorted(task.name for task in tasks) == ["Вёрстка", "Логотип"]
    # Каждая задача помнит, какая сессия её принесла: в истории остаётся
    # «создана AI-сессией».
    assert {task.created_by_ai_session_id for task in tasks} == {session.id}
    assert session.applied_batch_id == batch_id
    assert session.status == "applied"


def test_the_whole_batch_rolls_back_with_one_call(db, org, user):
    from app.mutations import undo_batch

    provider = RecordedProvider([QUESTION, SUMMARY, DRAFT])
    session = _interview(db, org, user, provider)
    intake.make_summary(db, session, provider)
    intake.make_draft(db, session, provider)
    project, batch_id = intake.apply_draft(db, session, name="Сайт", actor=user)

    undo_batch(db, project, batch_id, actor_id=user.id)

    assert db.scalars(select(Task).where(Task.project_id == project.id)).all() == []
    assert db.scalars(select(Category).where(Category.project_id == project.id)).all() == []


def test_applying_twice_is_refused(db, org, user):
    provider = RecordedProvider([QUESTION, SUMMARY, DRAFT])
    session = _interview(db, org, user, provider)
    intake.make_summary(db, session, provider)
    intake.make_draft(db, session, provider)
    intake.apply_draft(db, session, name="Сайт", actor=user)

    with pytest.raises(intake.IntakeError) as error:
        intake.apply_draft(db, session, name="Сайт ещё раз", actor=user)

    assert error.value.code == "already_applied"


def test_nothing_can_be_applied_before_the_draft(db, org, user):
    """Ворота нельзя обойти: применить нечего, пока черновика нет."""
    provider = RecordedProvider([QUESTION])
    session = _interview(db, org, user, provider)

    with pytest.raises(intake.IntakeError) as error:
        intake.apply_draft(db, session, name="Сайт", actor=user)

    assert error.value.code == "wrong_step"


# --- разбить задачу ----------------------------------------------------------


def test_split_proposes_but_does_not_write(db, org, user):
    provider = RecordedProvider([QUESTION, SUMMARY, DRAFT])
    session = _interview(db, org, user, provider)
    intake.make_summary(db, session, provider)
    intake.make_draft(db, session, provider)
    project, _ = intake.apply_draft(db, session, name="Сайт", actor=user)
    task = db.scalar(select(Task).where(Task.name == "Вёрстка"))
    before = len(db.scalars(select(Task).where(Task.project_id == project.id)).all())

    split_provider = RecordedProvider(
        [
            {
                "parts": [
                    {"name": "Шапка", "duration_days": 3},
                    {"name": "Главная", "duration_days": 4},
                    {"name": "Внутренние страницы", "duration_days": 3},
                ]
            }
        ]
    )
    parts = intake.propose_split(db, task, split_provider, locale="ru")

    assert [part["name"] for part in parts] == ["Шапка", "Главная", "Внутренние страницы"]
    # Предложение — это предложение: в проекте ничего не изменилось.
    assert len(db.scalars(select(Task).where(Task.project_id == project.id)).all()) == before

    batch_id = intake.apply_split(db, project, task, parts, actor=user)
    after = db.scalars(select(Task).where(Task.project_id == project.id)).all()
    assert len(after) == before + 3
    # Исходная задача на месте: её судьбу решает человек, а молчаливое удаление
    # унесло бы её историю и назначения.
    assert task in after
    assert batch_id is not None


# --- ключ --------------------------------------------------------------------


def test_the_key_is_stored_encrypted_and_never_returned(authed, db, org):
    response = authed.put(
        "/api/ai/credential",
        json={
            "base_url": "https://api.example.com/v1",
            "model": "gpt-4o-mini",
            "api_key": "sk-secret-value",
        },
    )

    assert response.status_code == 200
    assert "api_key" not in response.json()
    assert response.json()["configured"] is True

    row = db.scalar(select(OrgLlmCredential).where(OrgLlmCredential.org_id == org.id))
    assert "sk-secret-value" not in row.encrypted_key
    assert decrypt(row.encrypted_key) == "sk-secret-value"

    # Наружу не отдаётся никогда — только признак «ключ настроен».
    read = authed.get("/api/ai/credential").json()
    assert read == {
        "provider": "openai",
        "base_url": "https://api.example.com/v1",
        "model": "gpt-4o-mini",
        "configured": True,
    }


def test_the_address_and_model_can_be_changed_without_retyping_the_key(authed, db, org):
    authed.put(
        "/api/ai/credential",
        json={"base_url": "https://api.example.com/v1", "model": "a", "api_key": "sk-one"},
    )

    authed.put(
        "/api/ai/credential",
        json={"base_url": "http://localhost:8080/v1", "model": "llama", "api_key": ""},
    )

    row = db.scalar(select(OrgLlmCredential).where(OrgLlmCredential.org_id == org.id))
    assert row.base_url == "http://localhost:8080/v1"
    assert decrypt(row.encrypted_key) == "sk-one"


def test_the_first_connection_needs_a_key(authed):
    response = authed.put(
        "/api/ai/credential", json={"base_url": "https://x/v1", "model": "m", "api_key": ""}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "api_key_required"


def test_without_a_key_the_ai_routes_say_so_plainly(authed):
    """Нет ключа — кнопки AI неактивны со ссылкой в настройки.

    Отдельный код, а не общая ошибка: это не поломка, а ненастроенная
    установка.
    """
    response = authed.post("/api/ai/sessions", json={})

    assert response.status_code == 409
    assert response.json()["detail"] == "llm_not_configured"


def test_only_the_owner_sees_and_sets_the_connection(authed, db):
    user_id = authed.get("/api/auth/me").json()["id"]
    membership = db.scalar(select(Membership).where(Membership.user_id == uuid.UUID(user_id)))
    membership.role = "editor"
    db.flush()

    assert authed.get("/api/ai/credential").status_code == 403
    assert (
        authed.put(
            "/api/ai/credential",
            json={"base_url": "https://x/v1", "model": "m", "api_key": "sk"},
        ).status_code
        == 403
    )


def test_topics_are_read_from_the_config_file():
    """Список обязательных тем лежит файлом рядом с приложением, а не в базе."""
    keys = {topic["key"] for topic in intake.topics()}

    assert {"goal", "scope", "deadline", "out_of_scope"} <= keys


# --- маршруты ----------------------------------------------------------------


def test_the_session_walks_the_whole_way_over_http(authed, db, org, monkeypatch):
    """Сквозь HTTP: интервью → конспект → черновик → применение."""
    import app.api.ai_routes as routes
    from app.config import get_settings

    # Один вопрос вместо двенадцати: проверяется дорога целиком, а не глубина
    # интервью — её проверяет отдельный тест про потолок.
    monkeypatch.setattr(get_settings(), "ai_max_questions", 1, raising=False)
    provider = RecordedProvider([QUESTION, SUMMARY, DRAFT])
    monkeypatch.setattr(routes, "provider_for", lambda db, org: provider)

    started = authed.post("/api/ai/sessions", json={"locale": "ru"})
    assert started.status_code == 201
    session_id = started.json()["id"]

    authed.post(f"/api/ai/sessions/{session_id}/answers", json={"text": "Сайт-визитка"})
    summary = authed.post(f"/api/ai/sessions/{session_id}/summary")
    assert summary.json()["summary"] == SUMMARY["theses"]

    draft = authed.post(f"/api/ai/sessions/{session_id}/draft")
    assert draft.json()["status"] == "draft"

    applied = authed.post(f"/api/ai/sessions/{session_id}/apply", json={"name": "Сайт"})
    assert applied.status_code == 201
    project_id = applied.json()["project_id"]

    state = authed.get(f"/api/projects/{project_id}").json()
    assert sorted(category["name"] for category in state["categories"]) == ["Дизайн", "Разработка"]
    # Пачка видна как одно действие: кнопка отмены предложит откатить её целиком.
    assert state["undoable"]["batch_id"] == applied.json()["batch_id"]


def test_a_broken_answer_over_http_keeps_the_session_alive(authed, db, org, monkeypatch):
    import app.api.ai_routes as routes
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "ai_schema_retries", 0, raising=False)
    provider = RecordedProvider([QUESTION, SUMMARY, BROKEN_DRAFT])
    monkeypatch.setattr(routes, "provider_for", lambda db, org: provider)

    session_id = authed.post("/api/ai/sessions", json={"locale": "ru"}).json()["id"]
    authed.post(f"/api/ai/sessions/{session_id}/summary")

    refused = authed.post(f"/api/ai/sessions/{session_id}/draft")

    assert refused.status_code == 502
    assert refused.json()["detail"] == "llm_schema_mismatch"
    # Сессия жива и стоит на прежнем шаге: переписка и конспект на месте.
    alive = authed.get(f"/api/ai/sessions/{session_id}").json()
    assert alive["status"] == "summary"
    assert alive["summary"] == SUMMARY["theses"]


def test_a_session_of_another_organization_is_not_found(authed, db, monkeypatch):
    import app.api.ai_routes as routes

    monkeypatch.setattr(routes, "provider_for", lambda db, org: RecordedProvider([QUESTION]))
    other = Organization(name="Globex", slug="globex")
    db.add(other)
    db.flush()
    stranger = AiSession(org_id=other.id, locale="ru", status="interview", transcript=[])
    db.add(stranger)
    db.flush()

    assert authed.get(f"/api/ai/sessions/{stranger.id}").status_code == 404
