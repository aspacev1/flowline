"""Суточный бюджет токенов LLM организации.

Ключ приносит организация, и платит за него она же. Без бюджета один
участник — или один зациклившийся сценарий — выжигает месячный лимит ключа
за вечер, и узнаёт об этом владелец ключа по счёту. Бюджет продукта — это
предохранитель поверх лимитов провайдера, а не замена им.

Считается по календарным суткам UTC. Смена дня в чужом часовом поясе — не
та точность, ради которой стоит таскать в счётчик часовой пояс организации:
предохранитель одинаково работает при любом смещении границы суток.
"""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.models import AiUsage, Organization


def _today():
    return datetime.now(timezone.utc).date()


def spent_today(db: DbSession, org: Organization) -> int:
    return (
        db.scalar(
            select(AiUsage.tokens).where(AiUsage.org_id == org.id, AiUsage.day == _today())
        )
        or 0
    )


def budget_left(db: DbSession, org: Organization) -> bool:
    """Остался ли у организации бюджет на сегодня. 0 в настройке — без предела."""
    budget = get_settings().ai_daily_token_budget
    if budget <= 0:
        return True
    return spent_today(db, org) < budget


def charge(db: DbSession, org: Organization, tokens: int) -> None:
    """Записывает расход. Upsert, а не read-modify-write: два одновременных
    вызова модели не должны терять токены друг друга."""
    if tokens <= 0:
        return
    statement = pg_insert(AiUsage).values(org_id=org.id, day=_today(), tokens=tokens)
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[AiUsage.org_id, AiUsage.day],
            set_={"tokens": AiUsage.tokens + statement.excluded.tokens},
        )
    )


class MeteredProvider:
    """Обёртка провайдера: каждый ответ модели записывается в расход организации.

    Учёт здесь, а не в вызывающих местах: путей к модели несколько (интервью,
    тезисы, черновик, разбиение задачи), и место, забывшее посчитать, — это
    дыра в бюджете. propose_split до этой обёртки не считался вовсе.
    """

    def __init__(self, inner, db: DbSession, org: Organization):
        self._inner = inner
        self._db = db
        self._org = org

    def generate(self, messages: list[dict], schema: dict) -> tuple[dict, int]:
        payload, tokens = self._inner.generate(messages, schema)
        charge(self._db, self._org, tokens)
        return payload, tokens
