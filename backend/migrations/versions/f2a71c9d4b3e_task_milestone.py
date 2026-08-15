"""task milestone

tasks.milestone — признак вехи: точки на шкале вместо отрезка. Сдача этапа,
согласование, дедлайн подрядчика — то, что происходит в день, а не длится.

Отдельной таблицы не заводится: у вехи те же имя, категория, статус,
исполнители, комментарии и связи, что у задачи, и вторая сущность означала бы
второй набор операций, второй журнал и вторую отмену ради одного различия в
отрисовке.

Длительность у вехи остаётся хранимой и равной одному дню — это держит CHECK.
Расчёт даты окончания, снимки плана и порог сдвига спрашивают длительность у
всех задач одинаково, и nullable-колонка добавила бы в каждый из них ветку
«а если веха».

Живых вех до этой колонки не существовало, поэтому заполнять по таблице
нечего: server_default false отдаёт значение существующим строкам в момент
ADD COLUMN, и ограничение на них выполняется тривиально.

Revision ID: f2a71c9d4b3e
Revises: e8b3d6a1c4f7
Create Date: 2026-08-15 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2a71c9d4b3e'
down_revision: Union[str, Sequence[str], None] = 'e8b3d6a1c4f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default остаётся в схеме, а не снимается после заполнения: NOT NULL
    # без значения по умолчанию ломал бы всякий INSERT мимо ORM — тем же
    # рассуждением, что и у tasks.status.
    op.add_column(
        'tasks',
        sa.Column('milestone', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.create_check_constraint(
        'ck_tasks_milestone_duration', 'tasks', 'NOT milestone OR duration_days = 1'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('ck_tasks_milestone_duration', 'tasks', type_='check')
    op.drop_column('tasks', 'milestone')
