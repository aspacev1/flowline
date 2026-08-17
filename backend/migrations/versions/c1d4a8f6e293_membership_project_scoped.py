"""membership project scoped

memberships.project_scoped — видит ли это членство только те проекты, куда его
позвали поимённо, независимо от роли. Ролям `client` и гостю по ссылке это и
так решает сама роль (см. `_NEEDS_GRANT` в app.access) — колонка нужна ради
`editor` и `viewer`: приглашающий вправе позвать редактора или наблюдателя в
конкретные проекты, а не сразу во все проекты организации.

server_default остаётся в схеме, а не снимается после заполнения — тем же
рассуждением, что и у projects.auto_schedule: NOT NULL без значения по
умолчанию ломал бы всякий INSERT мимо ORM. False — обязанный выбор: приглашение
без отмеченных проектов не должно само по себе сужать роль, которая по
умолчанию видит всю организацию.

Revision ID: c1d4a8f6e293
Revises: e3c9a5d17b42
Create Date: 2026-08-17 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1d4a8f6e293'
down_revision: Union[str, Sequence[str], None] = 'e3c9a5d17b42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'memberships',
        sa.Column('project_scoped', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('memberships', 'project_scoped')
