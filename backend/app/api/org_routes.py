from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, parse_role
from app.auth import current_user
from app.db import get_db
from app.models import Membership, Organization, User
from app.settings_input import OrganizationSettingsIn, changes
from app.slugs import slug_check

router = APIRouter(prefix="/api/org", tags=["org"])


class MemberOut(BaseModel):
    id: str
    name: str
    email: str
    role: str


class OrganizationSettingsOut(BaseModel):
    """Дефолты организации — те самые, которые наследуют проекты.

    Отдаются всякому её участнику, а не только владельцу: рабочие дни и
    праздники видит каждый, кто видит диаграмму, — она ими и залита. Править
    их может только владелец, и это решается на записи, а не на чтении.
    """

    default_locale: str
    default_timezone: str
    working_days: int
    week_start: int
    holiday_calendar: list[str]
    default_shift_threshold_days: int
    public_sharing_enabled: bool
    default_comments_enabled: bool


class OrganizationOut(BaseModel):
    id: str
    name: str
    slug: str
    #: Роль спрашивающего в этой организации, а не свойство самой организации:
    #: интерфейс всё равно спросит её следующим запросом, чтобы решить, что
    #: показывать, и второй поход к серверу ради одного слова ничего не даёт.
    role: str
    settings: OrganizationSettingsOut


def _current_membership(db: DbSession, user: User) -> Membership:
    # Та же «первая по порядку» организация, что и в маршрутах проекта:
    # переключателя между организациями ещё нет.
    membership = db.scalar(
        select(Membership).where(Membership.user_id == user.id).order_by(Membership.id)
    )
    if membership is None:
        raise HTTPException(status_code=403, detail="no_organization")
    return membership


@router.get("", response_model=OrganizationOut)
def current_organization(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Организация, в которой человек находится прямо сейчас.

    Права здесь не проверяются: название своей организации видит любой её
    участник, включая роль `client`. Скрывать его не от кого — оно подписывает
    каждый экран, на который человек и так имеет право войти.
    """
    membership = _current_membership(db, user)
    org = db.get(Organization, membership.org_id)
    return _org_out(org, membership.role)


def _org_out(org: Organization, role: str) -> OrganizationOut:
    return OrganizationOut(
        id=str(org.id),
        name=org.name,
        slug=org.slug,
        role=role,
        settings=OrganizationSettingsOut(
            default_locale=org.default_locale,
            default_timezone=org.default_timezone,
            working_days=org.working_days,
            week_start=org.week_start,
            holiday_calendar=list(org.holiday_calendar or []),
            default_shift_threshold_days=org.default_shift_threshold_days,
            public_sharing_enabled=org.public_sharing_enabled,
            default_comments_enabled=org.default_comments_enabled,
        ),
    )


def _slug_taken(db: DbSession, slug: str, *, except_id) -> bool:
    query = select(Organization.id).where(Organization.slug == slug)
    if except_id is not None:
        query = query.where(Organization.id != except_id)
    return db.scalar(query) is not None


@router.patch("", response_model=OrganizationOut)
def update_organization(
    payload: OrganizationSettingsIn,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Уровень 2 настроек: дефолты, которые наследуют все проекты.

    Правит владелец. Производственный календарь живёт именно здесь, а не на
    проекте: никто не станет вбивать даты Новруза в каждый новый проект
    руками, а забытый праздник тихо сдвигает все сроки.

    Значения меняются по месту, а не копируются в проекты: проект хранит
    `null` — «наследовать», — и правка дефолта доходит до всех, кто его не
    переопределил. Копирование при создании выглядело бы так же ровно до
    первой правки дефолта, а потом расходилось бы навсегда.
    """
    membership = _current_membership(db, user)
    if not can(parse_role(membership.role), Action.ORG_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")

    org = db.get(Organization, membership.org_id)
    updates = changes(payload)

    if "slug" in updates and _slug_taken(db, updates["slug"], except_id=org.id):
        # Занятый слаг — не авария, а повод показать свободный вариант, и
        # интерфейс спросит его отдельным маршрутом. Здесь достаточно честного
        # отказа.
        raise HTTPException(status_code=409, detail="slug_taken")

    for field, value in updates.items():
        setattr(org, field, value)

    try:
        db.flush()
    except IntegrityError:
        # Гонка между проверкой и записью: уникальность держит база, а не
        # проверка выше — та лишь избавляет от отказа в обычном случае.
        db.rollback()
        raise HTTPException(status_code=409, detail="slug_taken")

    return _org_out(org, membership.role)


@router.get("/slug-check")
def check_org_slug(
    slug: str = Query(min_length=1, max_length=100),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Свободен ли такой слаг — и что предложить, если занят.

    Спрашивается из поля ввода до отправки формы: «занятый слаг подсказывает
    свободный вариант прямо в поле». Слаг здесь ещё и нормализуется, поэтому
    ответ заодно показывает, во что превратится введённое название.
    """
    membership = _current_membership(db, user)
    org = db.get(Organization, membership.org_id)

    def taken(candidate: str) -> bool:
        # Свой же слаг не считается занятым: иначе форма сообщала бы, что имя
        # занято, тому, кто его и занимает.
        return _slug_taken(db, candidate, except_id=org.id)

    return slug_check(slug, is_taken=taken, fallback="org")


@router.get("/members", response_model=list[MemberOut])
def list_members(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Люди, которых можно назначить исполнителями.

    Отказ здесь — 403, а не 404, в отличие от маршрутов проекта: адрес не
    называет никакой сущности, существование которой стоило бы скрывать, а
    свою организацию спрашивающий и так видит. По спеку роль client состава
    организации не получает вовсе — и отсутствие у неё PROJECT_READ без
    выданного доступа к проекту ровно это и означает.
    """
    membership = _current_membership(db, user)
    if not can(parse_role(membership.role), Action.PROJECT_READ):
        raise HTTPException(status_code=403, detail="forbidden")

    rows = db.execute(
        select(User, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.org_id == membership.org_id)
        .order_by(User.name, User.id)
    ).all()
    return [
        MemberOut(id=str(member.id), name=member.name, email=member.email, role=role)
        for member, role in rows
    ]
