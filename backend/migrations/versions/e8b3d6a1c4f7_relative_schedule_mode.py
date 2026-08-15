"""relative schedule mode

Разделение плана проекта и календарных дат: у проекта появляется режим
расписания (`relative` — предварительный план без дат, `calendar` — старт
назначен) и назначенная дата старта.

Существующие проекты помечаются `calendar`: их задачи уже живут настоящими
датами, и объявить их «планом без дат» значило бы переименовать прошлое.
server_default при этом остаётся `relative` — это режим по умолчанию для
новых проектов, у которых дата начала не спрашивается при создании.

Revision ID: e8b3d6a1c4f7
Revises: c9d2f6b8a154
Create Date: 2026-08-15 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e8b3d6a1c4f7'
down_revision: Union[str, Sequence[str], None] = 'c9d2f6b8a154'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'projects',
        sa.Column('schedule_mode', sa.Text(), server_default=sa.text("'relative'"), nullable=False),
    )
    op.add_column('projects', sa.Column('start_date', sa.Date(), nullable=True))
    # Бэкфилл раньше CHECK: ограничение обязано проверять уже правильные
    # строки, а не гоняться за ними.
    op.execute("UPDATE projects SET schedule_mode = 'calendar'")
    op.create_check_constraint(
        'ck_projects_schedule_mode',
        'projects',
        "schedule_mode IN ('relative', 'calendar')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('ck_projects_schedule_mode', 'projects', type_='check')
    op.drop_column('projects', 'start_date')
    op.drop_column('projects', 'schedule_mode')
