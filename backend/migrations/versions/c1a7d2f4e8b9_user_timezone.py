"""user timezone

users.timezone — часовой пояс читателя, по которому интерфейс считает
сегодняшний день. Nullable без значения по умолчанию: `null` означает
«спросить у браузера», и это состояние всех уже заведённых аккаунтов. Копия
пояса организации здесь была бы хуже пустоты — она выглядела бы как
сознательный выбор человека и пережила бы правку дефолта организации.

Revision ID: c1a7d2f4e8b9
Revises: b7c4e1f0a9d3
Create Date: 2026-08-15 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1a7d2f4e8b9'
down_revision: Union[str, Sequence[str], None] = 'b7c4e1f0a9d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('timezone', sa.String(length=64), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'timezone')
