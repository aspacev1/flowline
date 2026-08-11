"""Миграции против реальности: upgrade head на чистой базе, сверка с моделями,
обратимость downgrade.

Без этого теста расхождение цепочки миграций с models.py живёт незамеченным:
тесты приложения строят схему через create_all и потому проходят, а свежая
установка, которая накатывает alembic upgrade head, получает другую базу.

Тест работает не с базой из DATABASE_URL и не с базой conftest (`*_test`),
а с собственной одноразовой `*_migrations_test`: ему нужна база, в которой
не было create_all, — иначе upgrade падал бы на «таблица уже существует»,
а сверка сравнивала бы create_all сам с собой.
"""

import io

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from pathlib import Path
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from app.config import get_settings
from app.db import Base
from app import models  # noqa: F401  импорт ради регистрации таблиц

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _alembic_config(db_url: str) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    # Журнал команд alembic уходит в буфер, а не в stderr прогона тестов.
    config.stdout = io.StringIO()
    # Адрес подхватывает migrations/env.py — см. комментарий там.
    config.attributes["db_url"] = db_url
    return config


@pytest.fixture(scope="module")
def migrations_db_url():
    """Одноразовая чистая база; создаётся перед тестами модуля, сносится после.

    CREATE/DROP DATABASE выполняются через служебное подключение к базе из
    DATABASE_URL — саму её тест не трогает. Разрушающие операции разрешены
    только по имени с суффиксом `_migrations_test`.
    """
    admin_url = make_url(get_settings().database_url)
    db_name = f"{admin_url.database}_migrations_test"
    if not db_name.endswith("_migrations_test") or db_name == admin_url.database:
        raise RuntimeError(f"отказ сносить базу с подозрительным именем {db_name!r}")

    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{db_name}"'))

    yield admin_url.set(database=db_name).render_as_string(hide_password=False)

    with admin_engine.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)'))
    admin_engine.dispose()


def test_upgrade_head_matches_models(migrations_db_url):
    """`alembic upgrade head` на пустой базе даёт ровно ту схему, что в models.py."""
    command.upgrade(_alembic_config(migrations_db_url), "head")

    engine = create_engine(migrations_db_url)
    try:
        with engine.connect() as conn:
            diffs = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    finally:
        engine.dispose()

    assert diffs == [], (
        "схема после `alembic upgrade head` разошлась с models.py — "
        "недостающая или лишняя миграция:\n" + "\n".join(repr(d) for d in diffs)
    )


def test_downgrade_walks_back_to_empty(migrations_db_url):
    """Каждый downgrade выполним; после `downgrade base` таблиц не остаётся."""
    config = _alembic_config(migrations_db_url)
    command.upgrade(config, "head")
    command.downgrade(config, "base")

    engine = create_engine(migrations_db_url)
    try:
        leftovers = set(inspect(engine).get_table_names()) - {"alembic_version"}
    finally:
        engine.dispose()

    assert leftovers == set(), (
        f"после `alembic downgrade base` в базе остались таблицы: {sorted(leftovers)}"
    )
