"""verification sent and used

Две отметки на строке подтверждения адреса: когда письмо ушло и когда ссылкой
воспользовались.

`sent_at` отделяет отправку от выдачи токена: пауза между письмами считается
от письма, а токен выдаётся и тогда, когда почтовый сервер недоступен, — без
этой колонки неотправленное письмо запирало кнопку «отправить ещё раз».

`used_at` заменяет удаление строки при погашении: по ссылке из письма ходят
дважды (почтовый сканер, потом человек), и удалённая строка отвечала второму
заходу «ссылка не подходит» вместо «адрес уже подтверждён».

Обе пустые у существующих строк, и это верно: про уже выданные ссылки
неизвестно ни когда ушло письмо, ни гасили ли их. Пустой `sent_at` означает
«паузы нет» — худшее, что случится, это одно лишнее письмо тем, кто
регистрировался в минуту накатывания миграции.

Revision ID: e3c9a5d17b42
Revises: b8d1e5f30a72
Create Date: 2026-08-16 10:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3c9a5d17b42'
down_revision: Union[str, Sequence[str], None] = 'b8d1e5f30a72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'email_verifications',
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'email_verifications',
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('email_verifications', 'used_at')
    op.drop_column('email_verifications', 'sent_at')
