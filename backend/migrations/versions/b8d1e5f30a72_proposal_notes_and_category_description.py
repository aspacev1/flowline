"""proposal notes and category description

Два поля, которых не хватило смете по макету: примечания предложения целиком
(«оценки по текущему объёму», «ставки без стоимости лицензий») и строка
описания раздела, стоящая на его строке в таблице рядом со сводкой работ.

Отдельной ревизией, а не правкой d7e2b41c8f60: та уже накатана — дописывать
применённую миграцию значит оставить установку без новых колонок навсегда,
потому что alembic считает её ревизию пройденной и второй раз не выполняет.

Revision ID: b8d1e5f30a72
Revises: d7e2b41c8f60
Create Date: 2026-08-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b8d1e5f30a72'
down_revision: Union[str, Sequence[str], None] = 'd7e2b41c8f60'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default закрывает уже существующие строки: колонка NOT NULL без
    # значения по умолчанию не добавляется к непустой таблице вовсе.
    op.add_column(
        'proposals',
        sa.Column('notes', sa.Text(), server_default=sa.text("''"), nullable=False),
    )
    op.add_column(
        'proposal_categories',
        sa.Column('description', sa.Text(), server_default=sa.text("''"), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('proposal_categories', 'description')
    op.drop_column('proposals', 'notes')
