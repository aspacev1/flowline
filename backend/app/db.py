import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings


class Base(DeclarativeBase):
    pass


# Пул соединений имеет смысл там, где процесс один и живёт долго: под
# docker-compose и локальным uvicorn соединение открывается один раз и
# переиспользуется, а pool_pre_ping отсеивает то, что база успела закрыть
# сама.
#
# В serverless процессов не один, а столько, сколько платформа решила
# поднять под нагрузку, и каждый держал бы собственный пул. Postgres
# считает соединения глобально, поэтому такой расклад упирается в лимит
# сервера при вполне скромном трафике. NullPool отдаёт соединение сразу
# после запроса; переиспользование при этом никуда не девается — его берёт
# на себя внешний пулер (у Neon и Supabase это адрес с `-pooler`, его и надо
# класть в DATABASE_URL на Vercel).
#
# VERCEL платформа выставляет сама, вручную её задавать не нужно.
_engine_options: dict[str, object] = (
    {"poolclass": NullPool} if os.getenv("VERCEL") else {"pool_pre_ping": True}
)

engine = create_engine(get_settings().database_url, **_engine_options)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
