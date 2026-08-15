"""Сценарий интейка: интервью → конспект → черновик → применение.

Порядок шагов и ворота между ними не настраиваются: возможность отключить
ворота уничтожает главный принцип продукта — AI ничего не пишет в проект без
явного подтверждения человека.
"""

import uuid
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import yaml
from sqlalchemy.orm import Session as DbSession

from app.ai.provider import LlmError, LlmProvider
from app.calendar import end_date, first_working_on_or_after
from app.settings_resolution import project_calendar
from app.ai.schemas import (
    DRAFT_SCHEMA,
    QUESTION_SCHEMA,
    SPLIT_SCHEMA,
    SUMMARY_SCHEMA,
    Draft,
    NextQuestion,
    Split,
    Summary,
    parse,
)
from app.config import get_settings
from app.models import AiSession, Organization, Project, ScheduleMode, Task, User
from app.mutations import CreateCategory, CreateTask, apply_op
from app.projects import create_project

_TOPICS_FILE = Path(__file__).resolve().parents[3] / "config" / "intake_topics.yml"


@lru_cache
def topics() -> list[dict]:
    """Обязательные темы интервью — из файла рядом с приложением.

    Отсутствие файла не роняет приложение: интервью без списка тем всё равно
    работает, просто модель выбирает вопросы сама. Падать здесь значило бы
    поставить установку в зависимость от файла, который к продукту отношения
    не имеет.
    """
    try:
        loaded = yaml.safe_load(_TOPICS_FILE.read_text(encoding="utf-8")) or {}
    except OSError:
        return []
    return list(loaded.get("topics") or [])


class IntakeError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _system(session: AiSession) -> dict:
    """Общая часть промпта.

    Язык передаётся явным параметром, а не угадывается моделью по тексту
    ответов: человек может отвечать на одном языке, а вести проект на другом.
    """
    return {
        "role": "system",
        "content": (
            "Ты помогаешь составить план проекта. Задавай по одному вопросу. "
            f"Язык вопросов и всех значений в ответах: {session.locale}. "
            "Ключи полей в JSON остаются английскими."
        ),
    }


def _history(session: AiSession) -> list[dict]:
    messages: list[dict] = [_system(session)]
    for turn in session.transcript:
        messages.append({"role": "assistant", "content": turn.get("question", "")})
        if turn.get("answer") is not None:
            messages.append({"role": "user", "content": turn["answer"]})
    return messages


def _covered(session: AiSession) -> set[str]:
    return {topic for turn in session.transcript for topic in turn.get("covered", [])}


def _remaining(session: AiSession) -> list[dict]:
    covered = _covered(session)
    return [topic for topic in topics() if topic.get("key") not in covered]


def _generate(session: AiSession, provider: LlmProvider, messages: list[dict], schema: dict):
    """Один вызов модели с записью расхода токенов.

    Расход пишется по сессиям — это единственное место, где он вообще
    считается, и обходить его нельзя.
    """
    payload, tokens = provider.generate(messages, schema)
    session.tokens_used += tokens
    return payload


def start(
    db: DbSession, *, org: Organization, user: User, locale: str, provider: LlmProvider
) -> AiSession:
    session = AiSession(
        org_id=org.id, created_by=user.id, locale=locale, status="interview", transcript=[]
    )
    db.add(session)
    db.flush()
    ask(db, session, provider)
    return session


def ask(db: DbSession, session: AiSession, provider: LlmProvider) -> str:
    """Следующий вопрос.

    Жёсткий потолок вопросов живёт здесь: без него модель уточняет бесконечно.
    Дойдя до потолка, сессия сама переходит к конспекту — это не отказ, а
    переход к следующему шагу.
    """
    if session.status != "interview":
        raise IntakeError("wrong_step", "интервью уже закончено")

    asked = len(session.transcript)
    if asked >= get_settings().ai_max_questions:
        raise IntakeError("interview_exhausted", "вопросы кончились, пора к конспекту")

    remaining = _remaining(session)
    if remaining:
        instruction = (
            "Осталось выяснить: "
            + "; ".join(topic["prompt"] for topic in remaining)
            + ". Задай один следующий вопрос."
        )
    else:
        instruction = "Все темы закрыты. Задай последний уточняющий вопрос."

    messages = [*_history(session), {"role": "user", "content": instruction}]

    answer = parse(NextQuestion, _generate(session, provider, messages, QUESTION_SCHEMA))
    # Закрытые темы приходят вместе с вопросом и запоминаются: без этого
    # остаток тем никогда не убывает, и интервью упирается в потолок вместо
    # того, чтобы закончиться, когда выяснять больше нечего.
    #
    # Список переприсваивается целиком: JSONB не отслеживает правку списка на
    # месте, и append молча не доехал бы до базы.
    session.transcript = [
        *session.transcript,
        {"question": answer.question, "answer": None, "covered": answer.covered_topics},
    ]
    db.flush()
    return answer.question


def answer(db: DbSession, session: AiSession, text: str, provider: LlmProvider) -> str | None:
    """Ответ человека и следующий вопрос — или `None`, если пора к конспекту."""
    if session.status != "interview":
        raise IntakeError("wrong_step", "интервью уже закончено")
    if not session.transcript:
        raise IntakeError("nothing_asked", "вопрос ещё не задан")

    turns = [dict(turn) for turn in session.transcript]
    turns[-1]["answer"] = text
    session.transcript = turns
    db.flush()

    if len(session.transcript) >= get_settings().ai_max_questions or not _remaining(session):
        return None
    return ask(db, session, provider)


def make_summary(db: DbSession, session: AiSession, provider: LlmProvider) -> list[str]:
    """Шаг 2: конспект — первые ворота.

    Здесь дешевле всего поймать неверно понятое: до того, как оно превратится
    в сто неправильных задач.
    """
    messages = _history(session)
    messages.append(
        {
            "role": "user",
            "content": "Сформулируй тезисы: что ты понял про проект. Коротко, по одному факту.",
        }
    )
    result = parse(Summary, _generate(session, provider, messages, SUMMARY_SCHEMA))
    session.summary = result.theses
    session.status = "summary"
    db.flush()
    return result.theses


def edit_summary(db: DbSession, session: AiSession, theses: list[str]) -> list[str]:
    """Правка тезисов человеком. Ворота на то и ворота, что через них правят."""
    if session.status not in {"summary", "draft"}:
        raise IntakeError("wrong_step", "конспекта ещё нет")
    session.summary = [thesis.strip() for thesis in theses if thesis.strip()]
    db.flush()
    return session.summary


def make_draft(db: DbSession, session: AiSession, provider: LlmProvider) -> dict:
    """Шаг 3: черновик — главные ворота.

    Не прошло по схеме — повторный запрос, максимум `AI_SCHEMA_RETRIES` раз,
    затем честное сообщение об ошибке с сохранением сессии. Сессия при этом
    остаётся на прежнем шаге: переписка и всё выясненное никуда не деваются.
    """
    if session.status not in {"summary", "draft"}:
        raise IntakeError("wrong_step", "сначала конспект")

    messages = _history(session)
    messages.append(
        {
            "role": "user",
            "content": (
                "Вот утверждённые тезисы: "
                + "; ".join(session.summary)
                + ". Составь категории и задачи. Даты — в формате ГГГГ-ММ-ДД, "
                "длительность в рабочих днях."
            ),
        }
    )

    attempts = get_settings().ai_schema_retries + 1
    last: LlmError | None = None
    for _ in range(attempts):
        try:
            draft = parse(Draft, _generate(session, provider, messages, DRAFT_SCHEMA))
        except LlmError as error:
            last = error
            # Повтор только на битой схеме: недоступная сеть от повтора не
            # починится, а расход токенов утроится.
            if error.code not in {"llm_schema_mismatch", "llm_bad_json"}:
                raise
            continue
        session.draft = draft.model_dump(mode="json")
        session.status = "draft"
        db.flush()
        return session.draft

    raise last


def edit_draft(db: DbSession, session: AiSession, draft: dict) -> dict:
    """Правка черновика человеком: в проект не записано ничего."""
    if session.status != "draft":
        raise IntakeError("wrong_step", "черновика ещё нет")
    parsed = parse(Draft, draft)
    session.draft = parsed.model_dump(mode="json")
    db.flush()
    return session.draft


def apply_draft(
    db: DbSession, session: AiSession, *, name: str, actor: User
) -> tuple[Project, uuid.UUID]:
    """Шаг 4: применение — пачкой обычных мутаций с общим `batch_id`.

    Обычных — потому что иначе история задач, созданных AI, отличалась бы от
    истории остальных, и отмена для них была бы своя. Вся пачка откатывается
    одной кнопкой ровно потому, что это те же самые ревизии.
    """
    # «Уже применён» проверяется раньше «не тот шаг»: после применения статус
    # тоже не draft, и общий отказ сказал бы человеку не то, что случилось.
    if session.applied_batch_id is not None:
        raise IntakeError("already_applied", "черновик уже применён")
    if session.status != "draft":
        raise IntakeError("wrong_step", "черновика ещё нет")

    draft = parse(Draft, session.draft)
    project = create_project(db, org_id=session.org_id, name=name)
    # Черновик AI — план с настоящими датами: модель раскладывает задачи от
    # сегодняшнего дня. Такой проект рождается календарным, а не относительным:
    # относительная ось — для планов, у которых даты ещё не назначены.
    project.schedule_mode = ScheduleMode.CALENDAR
    batch_id = uuid.uuid4()

    for index, category in enumerate(draft.categories):
        created = apply_op(
            db,
            project,
            CreateCategory(name=category.name, color=_color(index)),
            actor_id=actor.id,
            batch_id=batch_id,
        )
        category_id = uuid.UUID(created.op["category_id"])
        for task in category.tasks:
            revision = apply_op(
                db,
                project,
                CreateTask(
                    category_id=category_id,
                    name=task.name,
                    description=task.description,
                    start_date=task.start_date,
                    duration_days=task.duration_days,
                    criticality=task.criticality.value,
                ),
                actor_id=actor.id,
                batch_id=batch_id,
            )
            row = db.get(Task, uuid.UUID(revision.op["task_id"]))
            row.created_by_ai_session_id = session.id

    session.project_id = project.id
    session.applied_batch_id = batch_id
    session.status = "applied"
    db.flush()
    return project, batch_id


# Палитра — оформление, а не данные: цвета для категорий AI берутся из того же
# короткого набора, что предлагает форма создания категории вручную.
_COLORS = ("#3b82f6", "#a855f7", "#f97316", "#10b981", "#ef4444", "#eab308")


def _color(index: int) -> str:
    return _COLORS[index % len(_COLORS)]


def propose_split(
    db: DbSession, task: Task, provider: LlmProvider, *, locale: str
) -> list[dict]:
    """Точечное действие «разбить на несколько».

    Возвращает предложение и ничего не пишет: применяется оно только по
    кнопке — тем же правилом, что и черновик.
    """
    messages = [
        {
            "role": "system",
            "content": (
                "Ты помогаешь разбить задачу на части. "
                f"Язык значений: {locale}. Ключи полей остаются английскими."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Задача «{task.name}» длится {task.duration_days} рабочих дней. "
                f"Описание: {task.description or '—'}. "
                "Разбей её на 3–5 частей с поделёнными сроками."
            ),
        },
    ]
    payload, _ = provider.generate(messages, SPLIT_SCHEMA)
    split = parse(Split, payload)
    return [part.model_dump(mode="json") for part in split.parts]


def apply_split(
    db: DbSession, project: Project, task: Task, parts: list[dict], *, actor: User
) -> uuid.UUID:
    """Применение разбиения: пачка мутаций, откатывается целиком.

    Исходная задача не удаляется автоматически — её судьбу решает человек:
    молчаливое удаление уносит её историю и назначения, а вернуть их отменой
    можно только вместе со всей пачкой.
    """
    split = parse(Split, {"parts": parts})
    batch_id = uuid.uuid4()
    # Части раскладываются по календарю проекта, а не по календарным дням:
    # длительность задана в рабочих днях, и часть на «5 дней», начатая в
    # среду, кончается во вторник, а не в понедельник. Прежний счёт по
    # ordinal смещал каждую следующую часть на выходные всех предыдущих.
    org = db.get(Organization, project.org_id)
    cal = project_calendar(project, org)
    start = task.start_date
    for part in split.parts:
        apply_op(
            db,
            project,
            CreateTask(
                category_id=task.category_id,
                name=part.name,
                description=part.description,
                start_date=start,
                duration_days=part.duration_days,
                criticality=task.criticality,
            ),
            actor_id=actor.id,
            batch_id=batch_id,
        )
        # Части идут подряд, а не одна поверх другой: следующая начинается с
        # первого рабочего дня после конца предыдущей.
        finished = end_date(start, part.duration_days, cal)
        start = first_working_on_or_after(finished + timedelta(days=1), cal)
    return batch_id
