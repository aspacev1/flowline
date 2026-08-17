import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, parse_role
from app.auth import current_session
from app.db import get_db
from app.models import Membership, Organization, Role, Session, User
from app.orgs import (
    LastOwner,
    current_membership,
    member_of,
    memberships_of,
    remove_membership,
    set_role,
    switch,
)
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


class SwitchIn(BaseModel):
    org_id: uuid.UUID


class MemberRoleIn(BaseModel):
    role: str


def _to_out(org: Organization, role: str) -> OrganizationOut:
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


@router.get("", response_model=OrganizationOut)
def current_organization(
    membership: Membership = Depends(current_membership), db: DbSession = Depends(get_db)
):
    """Организация, в которой человек находится прямо сейчас.

    Права здесь не проверяются: название своей организации видит любой её
    участник, включая роль `client`. Скрывать его не от кого — оно подписывает
    каждый экран, на который человек и так имеет право войти.
    """
    return _to_out(db.get(Organization, membership.org_id), membership.role)


@router.get("/list", response_model=list[OrganizationOut])
def list_organizations(
    session: Session = Depends(current_session), db: DbSession = Depends(get_db)
):
    """Организации, в которых человек состоит, — содержимое переключателя.

    Список отдаётся и тогда, когда организация одна: решать, показывать ли
    переключатель, — дело интерфейса, а не сервера, и ветка «а если одна»,
    заведённая здесь, повторилась бы в каждом клиенте.
    """
    return [_to_out(org, membership.role) for membership, org in memberships_of(db, session.user_id)]


@router.post("/switch", response_model=OrganizationOut)
def switch_organization(
    payload: SwitchIn,
    session: Session = Depends(current_session),
    db: DbSession = Depends(get_db),
):
    """Переключает сессию на другую организацию.

    Чужая организация неотличима от несуществующей: 404, а не 403 — иначе
    перебор по адресу превращается в способ выяснить, какие организации в
    установке вообще есть.
    """
    membership = switch(db, session, payload.org_id)
    if membership is None:
        raise HTTPException(status_code=404, detail="organization_not_found")
    return _to_out(db.get(Organization, membership.org_id), membership.role)


def _slug_taken(db: DbSession, slug: str, *, except_id) -> bool:
    query = select(Organization.id).where(Organization.slug == slug)
    if except_id is not None:
        query = query.where(Organization.id != except_id)
    return db.scalar(query) is not None


@router.patch("", response_model=OrganizationOut)
def update_organization(
    payload: OrganizationSettingsIn,
    membership: Membership = Depends(current_membership),
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

    return _to_out(org, membership.role)


@router.get("/slug-check")
def check_org_slug(
    slug: str = Query(min_length=1, max_length=100),
    membership: Membership = Depends(current_membership),
    db: DbSession = Depends(get_db),
):
    """Свободен ли такой слаг — и что предложить, если занят.

    Спрашивается из поля ввода до отправки формы: «занятый слаг подсказывает
    свободный вариант прямо в поле». Слаг здесь ещё и нормализуется, поэтому
    ответ заодно показывает, во что превратится введённое название.
    """
    org = db.get(Organization, membership.org_id)

    def taken(candidate: str) -> bool:
        # Свой же слаг не считается занятым: иначе форма сообщала бы, что имя
        # занято, тому, кто его и занимает.
        return _slug_taken(db, candidate, except_id=org.id)

    return slug_check(slug, is_taken=taken, fallback="org")


@router.get("/members", response_model=list[MemberOut])
def list_members(
    membership: Membership = Depends(current_membership), db: DbSession = Depends(get_db)
):
    """Люди, которых можно назначить исполнителями.

    Отказ здесь — 403, а не 404, в отличие от маршрутов проекта: адрес не
    называет никакой сущности, существование которой стоило бы скрывать, а
    свою организацию спрашивающий и так видит. По спеку роль client состава
    организации не получает вовсе — и отсутствие у неё PROJECT_READ без
    выданного доступа к проекту ровно это и означает.
    """
    if not can(parse_role(membership.role), Action.PROJECT_READ):
        raise HTTPException(status_code=403, detail="forbidden")

    rows = db.execute(
        select(User, Membership.role)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.org_id == membership.org_id)
        .order_by(User.name, User.id)
    ).all()
    return [
        MemberOut(id=str(person.id), name=person.name, email=person.email, role=role)
        for person, role in rows
    ]


def _target(db: DbSession, membership: Membership, user_id: uuid.UUID) -> Membership:
    """Членство человека, о котором идёт речь, в организации спрашивающего.

    Чужой участник неотличим от несуществующего: 404 на оба случая — иначе
    перебор по адресу превращается в способ выяснить, кто в этой установке
    вообще заведён.
    """
    found = member_of(db, org_id=membership.org_id, user_id=user_id)
    if found is None:
        raise HTTPException(status_code=404, detail="member_not_found")
    return found


def _parse_assignable_role(raw: str) -> Role:
    """Роль из запроса. Владелец здесь допустим — в отличие от приглашения.

    Приглашение владельца не выдаёт (NOT_INVITABLE в app.invitations): ссылка
    без адреса достаётся предъявителю, и владельцем становился бы всякий, кто
    её открыл. Здесь адресат — действующий участник, названный поимённо тем,
    кто и так распоряжается организацией целиком; это то самое «отдельное
    действие», ради которого приглашению владельца запрещено.
    """
    try:
        return Role(raw)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="unknown_role") from error


@router.patch("/members/{user_id}", response_model=MemberOut)
def update_member_role(
    user_id: uuid.UUID,
    payload: MemberRoleIn,
    membership: Membership = Depends(current_membership),
    db: DbSession = Depends(get_db),
):
    """Меняет роль участника. Правит владелец, и только он.

    Свою собственную роль владелец сменить может — пока он не последний.
    Запрещать это отдельно незачем: пока владельцев двое, разжалование
    отыгрывает назад второй, а на последнем срабатывает та же защита, что и
    на всех остальных путях остаться без владельца.
    """
    if not can(parse_role(membership.role), Action.ORG_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")

    role = _parse_assignable_role(payload.role)
    target = _target(db, membership, user_id)
    try:
        set_role(db, target, role)
    except LastOwner:
        raise HTTPException(status_code=409, detail="last_owner")

    person = db.get(User, target.user_id)
    return MemberOut(
        id=str(person.id), name=person.name, email=person.email, role=target.role
    )


@router.delete("/members/{user_id}", status_code=204)
def remove_member(
    user_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: DbSession = Depends(get_db),
):
    """Выводит человека из организации — или выпускает его самого.

    Один маршрут на оба действия, потому что действие и правда одно: членства
    больше нет. Разными их делает только то, кто вправе его выполнить —
    владелец над любым или человек над собой. Уход своими руками не требует
    прав в организации вовсе: роль `client` не видит даже её состава, и
    отдельного права «выйти» у неё нет и быть не должно — иначе позванный
    однажды остаётся внутри навсегда.
    """
    leaving = user_id == membership.user_id
    if not leaving and not can(parse_role(membership.role), Action.ORG_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")

    target = _target(db, membership, user_id)
    try:
        remove_membership(db, target)
    except LastOwner:
        raise HTTPException(status_code=409, detail="last_owner")
