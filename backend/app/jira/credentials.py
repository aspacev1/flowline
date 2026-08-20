"""Подключение Jira организации: хранение и превращение в клиента."""

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.crypto import DecryptionError, decrypt, encrypt
from app.jira.client import HttpJiraClient, JiraClient
from app.jira.errors import JiraError
from app.jira.netguard import ensure_public_https
from app.models import JiraConnection, Organization


def save_credential(
    db: DbSession,
    org: Organization,
    *,
    base_url: str,
    email: str,
    api_token: str | None,
) -> JiraConnection:
    """Сохраняет подключение. Пустой токен означает «оставить прежний» —
    тем же правилом, что ключ LLM: наружу токен не отдаётся никогда, и
    требовать его при правке адреса значило бы требовать невозможного.
    """
    ensure_public_https(base_url)

    existing = db.scalar(select(JiraConnection).where(JiraConnection.org_id == org.id))
    if existing is None:
        if not api_token:
            raise ValueError("токен обязателен при первом подключении")
        existing = JiraConnection(org_id=org.id, encrypted_token=encrypt(api_token))
        db.add(existing)

    existing.base_url = base_url
    existing.email = email
    if api_token:
        existing.encrypted_token = encrypt(api_token)
    db.flush()
    return existing


def credential(db: DbSession, org: Organization) -> JiraConnection | None:
    return db.scalar(select(JiraConnection).where(JiraConnection.org_id == org.id))


def drop_credential(db: DbSession, org: Organization) -> None:
    existing = credential(db, org)
    if existing is not None:
        db.delete(existing)
        db.flush()


def client_for(db: DbSession, org: Organization) -> JiraClient:
    """Клиент организации. Нет подключения — отказ кодом `jira_not_configured`,
    а не пятисоткой: установка без Jira — законное состояние, не поломка."""
    row = credential(db, org)
    if row is None:
        raise JiraError("jira_not_configured", "подключение Jira не настроено")
    try:
        token = decrypt(row.encrypted_token)
    except DecryptionError as error:
        raise JiraError("jira_key_unreadable", str(error)) from error

    return HttpJiraClient(
        base_url=row.base_url,
        email=row.email,
        api_token=token,
        timeout=get_settings().jira_request_timeout,
    )
