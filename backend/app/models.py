import uuid
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
    __table_args__ = (UniqueConstraint("org_id", "user_id"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(16))


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


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


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    color: Mapped[str] = mapped_column(String(9))
    position: Mapped[int] = mapped_column(Integer, default=0)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
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
    op: Mapped[dict] = mapped_column(JSON)
    inverse: Mapped[dict] = mapped_column(JSON)
    reason: Mapped[str | None] = mapped_column(Text)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
