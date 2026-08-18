"""user last active at

users.last_active_at — момент последней активности этого человека: последнего
запроса с его валидной сессией. Отдельное поле, а не производная от
Session.last_used_at: строки сессий подметаются (выход, просрочка, недельный
простой без обращений — см. app.auth), и агрегат по ним слепнет ровно тогда,
когда об активности спрашивают после давнего перерыва. Кормит панель
владельца установки (/api/admin/users): кто зарегистрирован и когда в
последний раз пользовался продуктом.

Nullable без значения по умолчанию: у уже заведённых аккаунтов, ни разу не
обратившихся с момента миграции, активности ещё не видно — то же состояние,
в котором рождается и только что созданный аккаунт.

Revision ID: f1a4c8d7b6e2
Revises: c1d4a8f6e293
Create Date: 2026-08-18 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a4c8d7b6e2'
down_revision: Union[str, Sequence[str], None] = 'c1d4a8f6e293'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('last_active_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'last_active_at')
