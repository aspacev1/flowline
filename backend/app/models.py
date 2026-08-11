import uuid
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.calendar import WEEKDAYS_MON_FRI
from app.db import Base


class Role(StrEnum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"
    CLIENT = "client"


class Criticality(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


# Выведен из Criticality, а не выписан вторым списком: два списка одних и тех
# же значений однажды разъедутся при добавлении уровня — ровно так же, как
# разъехался бы CHECK на роли, будь он выписан руками.
CRITICALITY_LEVELS: tuple[str, ...] = tuple(level.value for level in Criticality)


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100), unique=True)

    default_locale: Mapped[str] = mapped_column(String(5), default="az")
    default_timezone: Mapped[str] = mapped_column(String(64), default="Asia/Baku")
    working_days: Mapped[int] = mapped_column(Integer, default=WEEKDAYS_MON_FRI)
    week_start: Mapped[int] = mapped_column(Integer, default=0)
    holiday_calendar: Mapped[list] = mapped_column(JSON, default=list)
    default_shift_threshold_days: Mapped[int] = mapped_column(Integer, default=2)
    public_sharing_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    default_comments_enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    name: Mapped[str] = mapped_column(String(200))
    locale: Mapped[str] = mapped_column(String(5), default="az")
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("org_id", "user_id"),
        # Свободный String(16) пускал в колонку любое значение, а Role(...)
        # на нём поднимал ValueError уже в запросе. Список выведен из Role,
        # чтобы не разъехаться с ним при добавлении роли.
        CheckConstraint(
            "role IN (" + ", ".join(f"'{role.value}'" for role in Role) + ")",
            name="ck_memberships_role",
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    # Спрашивается на каждом запросе с сессией; составной (org_id, user_id)
    # ведёт не с той колонки и для этого поиска бесполезен.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Организация, выбранная переключателем. Живёт на сессии, а не на
    # пользователе: с одной вкладки смотрят свою компанию, с другой — чужую,
    # куда позвали, и общее поле у пользователя перебрасывало бы обе вкладки
    # разом. SET NULL, а не CASCADE: удалённая организация не должна уносить
    # с собой сессию — человек просто вернётся к первой доступной.
    active_org_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL")
    )


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("org_id", "slug"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100))
    deadline: Mapped[date | None] = mapped_column(Date)
    plan_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    plan_version: Mapped[int] = mapped_column(Integer, default=0)

    # nullable = «наследовать от организации»
    timezone: Mapped[str | None] = mapped_column(String(64))
    working_days: Mapped[int | None] = mapped_column(Integer)
    shift_threshold_days: Mapped[int | None] = mapped_column(Integer)

    holidays_extra: Mapped[list] = mapped_column(JSON, default=list)
    workdays_extra: Mapped[list] = mapped_column(JSON, default=list)


class ProjectAccess(Base):
    """Доступ к одному проекту, выданный человеку поимённо.

    Нужна роли `client`: она видит не все проекты организации, а только те,
    куда её позвали (см. `_NEEDS_GRANT` в app.access). Для остальных ролей
    записи здесь не значат ничего — их право читать проект следует из роли.
    """

    __tablename__ = "project_access"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    # Спрашивается на каждом чтении проекта ролью, которой нужен явный доступ,
    # и при сборке списка проектов такого человека — то есть с этой колонки.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )


class Invitation(Base):
    """Приглашение в организацию: одноразовое, с сроком жизни и ролью внутри.

    Живёт в базе и после принятия — это журнал того, кто кого привёл, а
    `accepted_at` заодно служит признаком «токен больше не работает».
    """

    __tablename__ = "invitations"
    __table_args__ = (
        # Тем же способом, что и у членства: список выведен из Role, чтобы
        # роль в приглашении нельзя было завести мимо матрицы прав.
        CheckConstraint(
            "role IN (" + ", ".join(f"'{role.value}'" for role in Role) + ")",
            name="ck_invitations_role",
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    # null — приглашение только по ссылке: оно достаётся предъявителю, и это
    # осознанный размен, а не недосмотр.
    email: Mapped[str | None] = mapped_column(String(320))
    role: Mapped[str] = mapped_column(String(16))
    # Проекты, к которым приглашение сразу даёт доступ. Нужны роли `client`;
    # у остальных ролей список пуст. Хранится списком id, а не таблицей
    # связей: он читается и переписывается целиком, поиска по нему нет.
    project_ids: Mapped[list] = mapped_column(JSON, default=list)
    # Хранится хеш, как у пароля и у сессии: дамп базы не должен раздавать
    # доступ к организациям. Прямое следствие — открытую ссылку показываем
    # один раз, в момент выпуска.
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    # SET NULL: ушедший из организации человек не уносит с собой запись о том,
    # кого он привёл.
    invited_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Заполняется только отправкой письма. Выпуск ссылки для копирования его
    # не трогает: письма не было, и в потолок рассылки такой выпуск не идёт.
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    color: Mapped[str] = mapped_column(String(9))
    position: Mapped[int] = mapped_column(Integer, default=0)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    internal_note: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[date] = mapped_column(Date)
    duration_days: Mapped[int] = mapped_column(Integer)
    criticality: Mapped[str] = mapped_column(String(16), default="normal")
    progress_pct: Mapped[int] = mapped_column(Integer, default=0)
    position: Mapped[int] = mapped_column(Integer, default=0)
    baseline_start: Mapped[date | None] = mapped_column(Date)
    baseline_duration: Mapped[int | None] = mapped_column(Integer)


class TaskAssignee(Base):
    __tablename__ = "task_assignees"
    __table_args__ = (UniqueConstraint("task_id", "user_id"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))


class Dependency(Base):
    __tablename__ = "dependencies"
    __table_args__ = (UniqueConstraint("from_task_id", "to_task_id"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    from_task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    to_task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))


class Revision(Base):
    __tablename__ = "revisions"
    __table_args__ = (UniqueConstraint("project_id", "seq"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    # jsonb, а не json: все три фичи, ради которых ведётся журнал, ищут по
    # содержимому полезной нагрузки. json хранит сырой текст, не умеет
    # операторов вхождения и не индексируется GIN. Продукт только под
    # Postgres; менять это после появления боевых записей — переписывание
    # таблицы, сегодня — бесплатно.
    op: Mapped[dict] = mapped_column(JSONB)
    inverse: Mapped[dict] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    # Пакет ревизий читается целиком при отмене групповой операции.
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
