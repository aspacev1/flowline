"""Счётчики частоты, живущие в базе.

В отличие от app.rate_limit (память процесса, предохранитель от заливки
гостевой ленты), эти счётчики стерегут вход и регистрацию — то есть перебор
паролей и массовое заведение аккаунтов. Такой предел обязан переживать
перезапуск процесса и быть общим для всех реплик, а единственное общее
хранилище этой архитектуры — Postgres: внешних сервисов (Redis, очередей)
у продукта нет намеренно.

Точность здесь не абсолютная: два конкурентных запроса могут оба пройти под
самый потолок — и это принято. Смысл предела — сделать перебор дороже на
порядки, а не отсчитать попытки до единой.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DbSession

from app.models import ThrottleEvent


def _cutoff(window_seconds: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(seconds=window_seconds)


def _sweep(db: DbSession, bucket: str, window_seconds: int) -> None:
    # Подметается только свой ключ: чужие окна могут быть длиннее, и общая
    # уборка по самому короткому окну съедала бы их события.
    db.execute(
        delete(ThrottleEvent).where(
            ThrottleEvent.bucket == bucket, ThrottleEvent.at < _cutoff(window_seconds)
        )
    )


def check(db: DbSession, bucket: str, *, limit: int, window_seconds: int) -> bool:
    """Укладывается ли ключ в потолок. Ничего не записывает.

    limit <= 0 означает «без предела»: рубильник, которым администратор
    выключает счётчик, не должен превращаться в «запрещено всё».
    """
    if limit <= 0:
        return True
    _sweep(db, bucket, window_seconds)
    count = db.scalar(
        select(func.count())
        .select_from(ThrottleEvent)
        .where(ThrottleEvent.bucket == bucket, ThrottleEvent.at >= _cutoff(window_seconds))
    )
    return count < limit


def note(db: DbSession, bucket: str) -> None:
    """Записывает попытку безусловно.

    Отдельно от check, потому что у входа считаются только неудачи: считать
    успехи значило бы запирать человека за то, что он работает с двух
    устройств; а неудача узнаётся уже после проверки пароля.
    """
    db.add(ThrottleEvent(bucket=bucket))
    db.flush()


def hit(db: DbSession, bucket: str, *, limit: int, window_seconds: int) -> bool:
    """Проверка и запись одним движением — для пределов, где считается всё."""
    if limit <= 0:
        return True
    if not check(db, bucket, limit=limit, window_seconds=window_seconds):
        return False
    note(db, bucket)
    return True
