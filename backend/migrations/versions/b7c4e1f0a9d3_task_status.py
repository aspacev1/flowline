"""task status

tasks.status — хранимый статус задачи (planned | in_progress | done | blocked).
Список значений держит CHECK — тем же приёмом, что ck_tasks_criticality:
второй путь записи (восстановление из журнала, ручной SQL) не должен уметь
положить значение, которое слой мутаций не принял бы.

Заполнение по живой таблице выводится из прогресса: до этой колонки статус
существовал только как производная от progress_pct, и стартовое значение
обязано совпасть с тем, что человек уже видел на диаграмме.

Revision ID: b7c4e1f0a9d3
Revises: 07266c100dff
Create Date: 2026-08-13 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c4e1f0a9d3'
down_revision: Union[str, Sequence[str], None] = '07266c100dff'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default отдаёт 'planned' существующим строкам в момент ADD COLUMN
    # и остаётся в схеме: NOT NULL без значения по умолчанию ломал бы всякий
    # INSERT мимо ORM.
    op.add_column(
        'tasks',
        sa.Column('status', sa.Text(), nullable=False, server_default=sa.text("'planned'")),
    )
    # Заполнение до CHECK: сперва каждой строке — статус, выведенный из её
    # прогресса, и только потом ограничение на значения.
    op.execute(
        "UPDATE tasks SET status = CASE"
        " WHEN progress_pct >= 100 THEN 'done'"
        " WHEN progress_pct > 0 THEN 'in_progress'"
        " ELSE 'planned' END"
    )
    op.create_check_constraint(
        'ck_tasks_status', 'tasks', "status IN ('planned', 'in_progress', 'done', 'blocked')"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('ck_tasks_status', 'tasks', type_='check')
    op.drop_column('tasks', 'status')
