"""scorecard

Скоркард проекта: недельная панель здоровья. Три таблицы и две метки времени
на задаче.

tasks.done_at / tasks.in_progress_since — когда задача стала «сделано» и когда
взята в работу. Ставятся и чистятся слоем мутаций при переходе статуса;
скоркарду нужны «закрыто на этой неделе» и «висит в работе N дней», а журнал
ревизий отвечает на эти вопросы только полным проходом по записям задачи.
Заполняются по журналу, где это возможно: для задач, стоящих в done или
in_progress сейчас, берётся последняя ревизия, приведшая их в этот статус
(set_status либо set_progress со связкой статуса). Задачам, чей статус
выставлен при создании и в журнале не менялся, метки не достаются — это
принятая неполнота бэкфилла, дальше их ведёт слой мутаций.

scorecard_metrics — конфиг метрики на проект (владелец, цель, включённость);
заводится лениво первым открытием скоркарда, настроек уровня организации нет.
scorecard_snapshots — недельные снимки значений и статусов; прошлые недели
неизменяемы, строка текущей недели перезаписывается и служит кэшем живого
расчёта. Цель и направление копируются в снимок: правка цели сегодня не должна
перекрашивать прошлые недели.
scorecard_alerts — события панели «Требует внимания»: риск-метрики текущей
недели и следы сработавшего правила «красная 2 недели подряд». Закрытые
события помечаются resolved_at, а не удаляются: по ним подавляется повтор
правила внутри одной серии.

Revision ID: b4e7a2c9d3f1
Revises: f1a4c8d7b6e2
Create Date: 2026-08-19 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b4e7a2c9d3f1'
down_revision: Union[str, Sequence[str], None] = 'f1a4c8d7b6e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _backfill_stamp(column: str, status: str) -> str:
    # Последняя ревизия, приведшая задачу в статус: set_status пишет статус в
    # `to`, set_progress — в `status_to` (связка «прогресс дотянут — сделано»).
    # DISTINCT ON с сортировкой по убыванию даты — свежайшая запись на задачу.
    return f"""
        UPDATE tasks SET {column} = latest.at
        FROM (
            SELECT DISTINCT ON (op->>'task_id') op->>'task_id' AS task_id,
                   created_at AS at
            FROM revisions
            WHERE (op->>'type' = 'set_status' AND op->>'to' = '{status}')
               OR (op->>'type' = 'set_progress' AND op->>'status_to' = '{status}')
            ORDER BY op->>'task_id', created_at DESC
        ) AS latest
        WHERE tasks.status = '{status}' AND tasks.id::text = latest.task_id
    """


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('tasks', sa.Column('done_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'tasks', sa.Column('in_progress_since', sa.DateTime(timezone=True), nullable=True)
    )
    op.execute(_backfill_stamp('done_at', 'done'))
    op.execute(_backfill_stamp('in_progress_since', 'in_progress'))

    op.create_table(
        'scorecard_metrics',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('metric_key', sa.String(length=40), nullable=False),
        sa.Column('owner_user_id', sa.UUID(), nullable=True),
        sa.Column('target_value', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('direction', sa.String(length=3), nullable=False),
        sa.Column('warn_value', sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column('enabled', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "direction IN ('lte', 'gte')", name='ck_scorecard_metrics_direction'
        ),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'metric_key'),
    )
    op.create_index(
        op.f('ix_scorecard_metrics_project_id'), 'scorecard_metrics', ['project_id'],
        unique=False,
    )

    op.create_table(
        'scorecard_snapshots',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('metric_key', sa.String(length=40), nullable=False),
        sa.Column('week_start', sa.Date(), nullable=False),
        sa.Column('value', sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column('target_value', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('direction', sa.String(length=3), nullable=False),
        sa.Column('status', sa.String(length=8), nullable=False),
        sa.Column(
            'computed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column('computed_by', sa.UUID(), nullable=True),
        sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint(
            "direction IN ('lte', 'gte')", name='ck_scorecard_snapshots_direction'
        ),
        sa.CheckConstraint(
            "status IN ('ok', 'warn', 'risk', 'no_data')",
            name='ck_scorecard_snapshots_status',
        ),
        sa.ForeignKeyConstraint(['computed_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'metric_key', 'week_start'),
    )
    op.create_index(
        op.f('ix_scorecard_snapshots_project_id'), 'scorecard_snapshots', ['project_id'],
        unique=False,
    )
    op.create_index(
        'ix_scorecard_snapshots_project_week', 'scorecard_snapshots',
        ['project_id', 'week_start'], unique=False,
    )

    op.create_table(
        'scorecard_alerts',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('metric_key', sa.String(length=40), nullable=False),
        sa.Column('week_start', sa.Date(), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            'created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('rule_triggered', 'metric_risk')", name='ck_scorecard_alerts_kind'
        ),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_scorecard_alerts_project_id'), 'scorecard_alerts', ['project_id'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_scorecard_alerts_project_id'), table_name='scorecard_alerts')
    op.drop_table('scorecard_alerts')
    op.drop_index('ix_scorecard_snapshots_project_week', table_name='scorecard_snapshots')
    op.drop_index(op.f('ix_scorecard_snapshots_project_id'), table_name='scorecard_snapshots')
    op.drop_table('scorecard_snapshots')
    op.drop_index(op.f('ix_scorecard_metrics_project_id'), table_name='scorecard_metrics')
    op.drop_table('scorecard_metrics')
    op.drop_column('tasks', 'in_progress_since')
    op.drop_column('tasks', 'done_at')
