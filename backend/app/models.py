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
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
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

    # Последнее обращение с этой сессией — для idle-таймаута: украденная кука
    # с брошенного устройства не должна жить все тридцать дней срока годности
    # только потому, что её однажды выдали. Обновляется с шагом (см.
    # app.auth), а не на каждый запрос: иначе каждое чтение проекта — это
    # ещё и запись в таблицу сессий.
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ThrottleEvent(Base):
    """Событие для счётчиков частоты: одна строка — одна учтённая попытка.

    В базе, а не в памяти процесса, потому что вход и регистрацию — в
    отличие от гостевых комментариев — стерегут не от заливки, а от перебора
    паролей: предохранитель, который обнуляется перезапуском процесса и не
    виден соседней реплике, там не предохранитель. База — единственное
    общее хранилище этой архитектуры (внешних сервисов у продукта нет).

    Ключ — произвольная строка вида «login:ip:…»; составитель сам отвечает
    за её уникальность между применениями. Старые строки подметаются
    попутно при каждом обращении к своему ключу.
    """

    __tablename__ = "throttle_events"
    __table_args__ = (Index("ix_throttle_events_bucket_at", "bucket", "at"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    bucket: Mapped[str] = mapped_column(String(120))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AiUsage(Base):
    """Расход токенов LLM организацией за календарные сутки.

    Отдельно от AiSession.tokens_used: сессия считает свой разговор, а
    бюджет — всё, что организация потратила за день, включая точечные
    действия вроде разбиения задачи, у которых сессии нет вовсе.
    """

    __tablename__ = "ai_usage"
    __table_args__ = (UniqueConstraint("org_id", "day"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE")
    )
    day: Mapped[date] = mapped_column(Date)
    tokens: Mapped[int] = mapped_column(Integer, default=0)


class EmailVerification(Base):
    """Одноразовая ссылка подтверждения адреса.

    Устроена как сессия: наружу уходит открытый токен, в базе лежит его
    хеш — утечка дампа не даёт подтвердить чужой адрес. Строка живёт до
    первого перехода по ссылке или до истечения срока, поэтому таблица не
    растёт: подтверждение удаляет все токены пользователя разом.
    """

    __tablename__ = "email_verifications"

    id: Mapped[uuid.UUID] = _uuid_pk()
    # Ищется по владельцу на каждой повторной отправке и на подтверждении.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
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


class ShareLink(Base):
    """Публичная ссылка на проект.

    Токен лежит открытым текстом — сознательно, в отличие от приглашения,
    где хранится хеш. Приглашение показывается один раз и уходит адресату;
    публичную ссылку владелец копирует снова и снова, из настроек проекта,
    и сервер, забывший её, оставил бы единственный способ «показать ссылку
    ещё раз» — выпустить новую и убить действующую. Цена размена названа
    прямо: утёкший дамп базы отдаёт чтение опубликованных проектов, а не
    доступ к организациям.

    Отозванная ссылка не удаляется, а помечается `revoked_at`: старый адрес
    обязан отвечать «ссылка больше не действует», а не «такого проекта нет».
    """

    __tablename__ = "share_links"
    __table_args__ = (
        # Действующая ссылка у проекта одна. Частичный индекс, а не обычное
        # ограничение уникальности: отозванных ссылок у проекта сколько
        # угодно — это журнал того, какой адрес когда умер.
        Index(
            "uq_share_links_active_project",
            "project_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    token: Mapped[str] = mapped_column(String(64), unique=True)
    comments_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Comment(Base):
    """Реплика к проекту или к одной его задаче.

    Автор — либо участник с аккаунтом, либо гость по ссылке, назвавший себя
    именем. Ровно один из двух: комментарий без автора не подписан никем, а
    комментарий с обоими — это участник, притворившийся гостем. Держит это
    ограничение база, а не проверка в маршруте: маршрутов, создающих
    комментарий, уже два.
    """

    __tablename__ = "comments"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(author_user_id, guest_name) = 1",
            name="ck_comments_single_author",
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    # null — комментарий к проекту целиком, а не к задаче.
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    # CASCADE, а не SET NULL: обнулённый автор оставил бы запись без подписи
    # вовсе — ни аккаунта, ни имени гостя, — то есть нарушил бы ограничение
    # ниже прямо в момент удаления человека.
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    guest_name: Mapped[str | None] = mapped_column(String(80))
    body: Mapped[str] = mapped_column(Text)
    # Внутренняя реплика: видна участникам, гостю публичной ссылки — нет.
    # По умолчанию false — разговор с клиентом остаётся общим, как и был;
    # признак ставит автор, решивший говорить «в сторону». server_default
    # закрывает и старые строки: до появления признака все реплики были
    # публичными по факту.
    internal: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # clock_timestamp(), а не now(): now() отдаёт время начала транзакции, и
    # две реплики, вставленные в одной, получают одинаковую метку — а
    # порядок в разговоре держится именно на ней. У журнала ревизий для
    # этого есть seq, у комментариев его нет и заводить его незачем.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
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
    # Откуда взялась задача. В истории остаётся «создана AI-сессией от
    # 10 августа», и без этого поля такой записи неоткуда взяться: журнал
    # ревизий хранит операцию, а не её происхождение.
    created_by_ai_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ai_sessions.id", ondelete="SET NULL")
    )


class PlanVersion(Base):
    """Утверждённый план: снимок дат и длительностей на момент утверждения.

    Отдельная таблица, а не только baseline_* у задачи: базовые поля задачи
    хранят последнюю версию, а летопись «что обещали в январе, что в марте»
    требует всех предыдущих. Версии нумеруются внутри проекта, и уникальное
    ограничение держит эту нумерацию: два одновременных утверждения иначе
    получили бы один номер.
    """

    __tablename__ = "plan_versions"
    __table_args__ = (UniqueConstraint("project_id", "version"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # jsonb по той же причине, что и журнал ревизий: снимок читается целиком,
    # но по нему же ищут задачу при сравнении версий.
    snapshot: Mapped[dict] = mapped_column(JSONB)


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


class OrgLlmCredential(Base):
    """Подключение LLM: одно на организацию.

    `base_url` и `model` — обязательные настройки, а не константы: без них
    BYOK работает с одним облаком по одной зашитой модели, и обещание «можно
    подсунуть локальную модель» остаётся на словах.

    Ключ шифруется симметрично секретом приложения и наружу не отдаётся
    никогда — только признак «ключ настроен».
    """

    __tablename__ = "org_llm_credentials"

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), unique=True
    )
    provider: Mapped[str] = mapped_column(String(32), default="openai")
    base_url: Mapped[str] = mapped_column(String(300))
    model: Mapped[str] = mapped_column(String(100))
    encrypted_key: Mapped[str] = mapped_column(Text)


class AiSession(Base):
    """Интервью, конспект и черновик — до применения в проект.

    Живёт отдельно от проекта, потому что проекта до применения не существует:
    AI ничего не пишет в проект без явного подтверждения человека.
    """

    __tablename__ = "ai_sessions"

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    # Заполняется после применения: до него проекта нет.
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL")
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    # Язык интервью фиксируется на сессии, а не берётся из профиля каждый раз:
    # человек, переключивший интерфейс посреди интервью, иначе получил бы
    # черновик наполовину на одном языке, наполовину на другом.
    locale: Mapped[str] = mapped_column(String(5), default="az")
    status: Mapped[str] = mapped_column(String(16), default="interview")
    transcript: Mapped[list] = mapped_column(JSONB, default=list)
    summary: Mapped[list] = mapped_column(JSONB, default=list)
    draft: Mapped[dict] = mapped_column(JSONB, default=dict)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    applied_batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


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
    # Номер ревизии, которую эта отменила. Без него «отменить последнее»
    # означало бы отменить свою же отмену: журнал линеен, и вторая ревизия
    # сверху после отмены — это она сама. Внешнего ключа нет намеренно:
    # ссылаться пришлось бы на составной (project_id, seq), а выигрыш от такой
    # ссылки нулевой — ревизии не удаляются.
    undoes_seq: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
