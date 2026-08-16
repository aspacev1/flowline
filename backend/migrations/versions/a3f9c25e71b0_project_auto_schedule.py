"""project auto schedule

projects.auto_schedule — автоперенос по связям: последователь не начинается
раньше, чем кончился его предшественник (см. app/cascade.py).

Выключен по умолчанию, и это не осторожность ради осторожности: до этой колонки
связь не двигала ничего вовсе — она была картинкой, а единственным поведением,
выведенным из связей, оставалось предложение подвинуть задачу вручную.
Включённый автоперенос меняет смысл каждой связи в проекте разом, и случиться
это должно по решению человека, а не при накатывании миграции.

Свойство проекта, а не организации: в одном проекте план ведут по цепочке, в
соседнем — руками, и общая настройка заставила бы выбирать одно на всех.

Revision ID: a3f9c25e71b0
Revises: f2a71c9d4b3e
Create Date: 2026-08-16 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f9c25e71b0'
down_revision: Union[str, Sequence[str], None] = 'f2a71c9d4b3e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default остаётся в схеме, а не снимается после заполнения: NOT NULL
    # без значения по умолчанию ломал бы всякий INSERT мимо ORM — тем же
    # рассуждением, что и у tasks.status.
    op.add_column(
        'projects',
        sa.Column('auto_schedule', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('projects', 'auto_schedule')
