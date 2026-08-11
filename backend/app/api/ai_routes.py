"""HTTP вокруг AI-интейка. Бизнес-логики здесь нет — она в app/ai/."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, parse_role
from app.ai import intake
from app.ai.credentials import credential, provider_for, save_credential
from app.ai.provider import LlmError, LlmProvider
from app.auth import current_user
from app.db import get_db
from app.models import AiSession, Membership, Organization, Project, Task, User

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _membership(db: DbSession, user: User) -> Membership:
    membership = db.scalar(
        select(Membership).where(Membership.user_id == user.id).order_by(Membership.id)
    )
    if membership is None:
        raise HTTPException(status_code=403, detail="no_organization")
    return membership


def _writer(db: DbSession, user: User) -> tuple[Organization, Membership]:
    membership = _membership(db, user)
    if not can(parse_role(membership.role), Action.PROJECT_WRITE):
        raise HTTPException(status_code=403, detail="forbidden")
    return db.get(Organization, membership.org_id), membership


def _refuse(error: Exception) -> HTTPException:
    """Сбой модели — не пятисотка.

    Таймаут, мусор вместо схемы и исчерпанный лимит ключа — это состояния, о
    которых человеку говорят словами, а переписка и черновик при этом
    сохраняются: сессия продолжается с того же места.
    """
    code = getattr(error, "code", "llm_failed")
    if code == "llm_not_configured":
        return HTTPException(status_code=409, detail=code)
    return HTTPException(status_code=502, detail=code)


# --- подключение LLM ---------------------------------------------------------


class CredentialIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(default="openai", max_length=32)
    base_url: str = Field(min_length=1, max_length=300)
    model: str = Field(min_length=1, max_length=100)
    #: Пустой — оставить прежний ключ. Наружу ключ не отдаётся никогда, и
    #: требовать его при правке адреса значило бы требовать невозможного.
    api_key: str = ""


class CredentialOut(BaseModel):
    provider: str
    base_url: str
    model: str
    #: Только признак. Самого ключа здесь нет и быть не может.
    configured: bool


@router.get("/credential", response_model=CredentialOut)
def read_credential(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    membership = _membership(db, user)
    if not can(parse_role(membership.role), Action.ORG_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")
    row = credential(db, db.get(Organization, membership.org_id))
    if row is None:
        return CredentialOut(provider="", base_url="", model="", configured=False)
    return CredentialOut(
        provider=row.provider, base_url=row.base_url, model=row.model, configured=True
    )


@router.put("/credential", response_model=CredentialOut)
def write_credential(
    payload: CredentialIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    membership = _membership(db, user)
    if not can(parse_role(membership.role), Action.ORG_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")
    org = db.get(Organization, membership.org_id)
    try:
        row = save_credential(
            db,
            org,
            provider=payload.provider,
            base_url=payload.base_url,
            model=payload.model,
            api_key=payload.api_key,
        )
    except ValueError:
        raise HTTPException(status_code=422, detail="api_key_required")
    return CredentialOut(
        provider=row.provider, base_url=row.base_url, model=row.model, configured=True
    )


# --- сессия ------------------------------------------------------------------


def _session(db: DbSession, org: Organization, session_id: uuid.UUID) -> AiSession:
    session = db.get(AiSession, session_id)
    if session is None or session.org_id != org.id:
        raise HTTPException(status_code=404, detail="ai_session_not_found")
    return session


def _provider(db: DbSession, org: Organization) -> LlmProvider:
    try:
        return provider_for(db, org)
    except LlmError as error:
        raise _refuse(error)


def _out(session: AiSession) -> dict:
    return {
        "id": str(session.id),
        "status": session.status,
        "locale": session.locale,
        "transcript": session.transcript,
        "summary": session.summary,
        "draft": session.draft,
        "tokens_used": session.tokens_used,
        "project_id": str(session.project_id) if session.project_id else None,
        "applied_batch_id": (
            str(session.applied_batch_id) if session.applied_batch_id else None
        ),
    }


class StartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Язык интервью фиксируется на сессии: переключивший интерфейс посреди
    #: разговора получил бы иначе черновик на двух языках сразу.
    locale: str | None = None


@router.post("/sessions", status_code=201)
def start_session(
    payload: StartIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    org, _ = _writer(db, user)
    provider = _provider(db, org)
    try:
        session = intake.start(
            db, org=org, user=user, locale=payload.locale or user.locale, provider=provider
        )
    except LlmError as error:
        raise _refuse(error)
    return _out(session)


@router.get("/sessions/{session_id}")
def read_session(
    session_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    org, _ = _writer(db, user)
    return _out(_session(db, org, session_id))


class AnswerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=4000)


@router.post("/sessions/{session_id}/answers")
def answer_question(
    session_id: uuid.UUID,
    payload: AnswerIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    org, _ = _writer(db, user)
    session = _session(db, org, session_id)
    try:
        intake.answer(db, session, payload.text, _provider(db, org))
    except intake.IntakeError as error:
        raise HTTPException(status_code=409, detail=error.code)
    except LlmError as error:
        raise _refuse(error)
    return _out(session)


@router.post("/sessions/{session_id}/summary")
def build_summary(
    session_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    """Ворота 1: «вот что я понял про проект»."""
    org, _ = _writer(db, user)
    session = _session(db, org, session_id)
    try:
        intake.make_summary(db, session, _provider(db, org))
    except LlmError as error:
        raise _refuse(error)
    return _out(session)


class SummaryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    theses: list[str]


@router.put("/sessions/{session_id}/summary")
def edit_summary(
    session_id: uuid.UUID,
    payload: SummaryIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    org, _ = _writer(db, user)
    session = _session(db, org, session_id)
    try:
        intake.edit_summary(db, session, payload.theses)
    except intake.IntakeError as error:
        raise HTTPException(status_code=409, detail=error.code)
    return _out(session)


@router.post("/sessions/{session_id}/draft")
def build_draft(
    session_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    """Ворота 2, главные: черновик. В проект не записано ничего."""
    org, _ = _writer(db, user)
    session = _session(db, org, session_id)
    try:
        intake.make_draft(db, session, _provider(db, org))
    except intake.IntakeError as error:
        raise HTTPException(status_code=409, detail=error.code)
    except LlmError as error:
        # Сессия остаётся на прежнем шаге: переписка и всё выясненное никуда не
        # делись, и повторить можно тем же запросом.
        raise _refuse(error)
    return _out(session)


class DraftIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft: dict


@router.put("/sessions/{session_id}/draft")
def edit_draft(
    session_id: uuid.UUID,
    payload: DraftIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    org, _ = _writer(db, user)
    session = _session(db, org, session_id)
    try:
        intake.edit_draft(db, session, payload.draft)
    except intake.IntakeError as error:
        raise HTTPException(status_code=409, detail=error.code)
    except LlmError as error:
        # Правку человека схема проверяет так же, как ответ модели: иначе
        # черновик, испорченный руками, доехал бы до применения.
        raise HTTPException(status_code=422, detail=error.code)
    return _out(session)


class ApplyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)


@router.post("/sessions/{session_id}/apply", status_code=201)
def apply_session(
    session_id: uuid.UUID,
    payload: ApplyIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Шаг 4: применение пачкой мутаций с общим batch_id."""
    org, _ = _writer(db, user)
    session = _session(db, org, session_id)
    try:
        project, batch_id = intake.apply_draft(db, session, name=payload.name, actor=user)
    except intake.IntakeError as error:
        raise HTTPException(status_code=409, detail=error.code)
    except LlmError as error:
        raise HTTPException(status_code=422, detail=error.code)
    return {"project_id": str(project.id), "batch_id": str(batch_id), "session": _out(session)}


# --- точечное действие -------------------------------------------------------


def _own_task(db: DbSession, org: Organization, task_id: uuid.UUID) -> tuple[Project, Task]:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    project = db.get(Project, task.project_id)
    if project is None or project.org_id != org.id:
        raise HTTPException(status_code=404, detail="task_not_found")
    return project, task


@router.post("/tasks/{task_id}/split")
def propose_split(
    task_id: uuid.UUID, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    """Предложение разбить задачу. Ничего не пишет: применяется по кнопке."""
    org, _ = _writer(db, user)
    _, task = _own_task(db, org, task_id)
    try:
        parts = intake.propose_split(db, task, _provider(db, org), locale=user.locale)
    except LlmError as error:
        raise _refuse(error)
    return {"task_id": str(task.id), "parts": parts}


class SplitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parts: list[dict]


@router.post("/tasks/{task_id}/split/apply", status_code=201)
def apply_split(
    task_id: uuid.UUID,
    payload: SplitIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    org, _ = _writer(db, user)
    project, task = _own_task(db, org, task_id)
    try:
        batch_id = intake.apply_split(db, project, task, payload.parts, actor=user)
    except LlmError as error:
        raise HTTPException(status_code=422, detail=error.code)
    return {"batch_id": str(batch_id)}
