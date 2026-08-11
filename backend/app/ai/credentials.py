"""Ключ LLM организации: хранение и превращение в провайдера."""

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.ai.provider import HttpProvider, LlmError, LlmProvider
from app.config import get_settings
from app.crypto import DecryptionError, decrypt, encrypt
from app.models import Organization, OrgLlmCredential


def save_credential(
    db: DbSession,
    org: Organization,
    *,
    provider: str,
    base_url: str,
    model: str,
    api_key: str | None,
) -> OrgLlmCredential:
    """Сохраняет подключение. Пустой ключ означает «оставить прежний».

    Иначе правка адреса модели требовала бы вводить ключ заново — а взять его
    неоткуда: наружу он не отдаётся никогда.
    """
    existing = db.scalar(select(OrgLlmCredential).where(OrgLlmCredential.org_id == org.id))
    if existing is None:
        if not api_key:
            raise ValueError("ключ обязателен при первом подключении")
        existing = OrgLlmCredential(org_id=org.id, encrypted_key=encrypt(api_key))
        db.add(existing)

    existing.provider = provider
    existing.base_url = base_url
    existing.model = model
    if api_key:
        existing.encrypted_key = encrypt(api_key)
    db.flush()
    return existing


def credential(db: DbSession, org: Organization) -> OrgLlmCredential | None:
    return db.scalar(select(OrgLlmCredential).where(OrgLlmCredential.org_id == org.id))


def provider_for(db: DbSession, org: Organization) -> LlmProvider:
    """Провайдер организации.

    Нет ключа — кнопки AI неактивны со ссылкой в настройки, и отказ здесь
    отдельным кодом: это не поломка, а ненастроенная установка.
    """
    row = credential(db, org)
    if row is None:
        raise LlmError("llm_not_configured", "подключение LLM не настроено")
    try:
        api_key = decrypt(row.encrypted_key)
    except DecryptionError as error:
        # Сменили APP_SECRET, не перешифровав ключи. Отдельный код: чинится это
        # не вводом ключа заново, а возвратом прежнего секрета — или
        # осознанным вводом нового ключа.
        raise LlmError("llm_key_unreadable", str(error)) from error

    return HttpProvider(
        base_url=row.base_url,
        model=row.model,
        api_key=api_key,
        timeout=get_settings().ai_request_timeout,
    )
