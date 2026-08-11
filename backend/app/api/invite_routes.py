"""Приглашения: выпуск и управление ими — в организации, приём — по ссылке.

Два маршрутизатора в одном файле, потому что это две стороны одной сущности:
разведённые по файлам, они разъедутся в понимании того, что такое «живое
приглашение».
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.access import Action, can, parse_role
from app.auth import current_user
from app.db import get_db
from app.invitations import (
    InvitationError,
    accept,
    create_invitation,
    invite_link,
    mark_sent,
    peek,
    reissue,
    revoke,
    status,
)
from app.mail import MailError, get_mailer
from app.models import Invitation, Membership, Organization, Role, User

org_router = APIRouter(prefix="/api/org/invitations", tags=["invitations"])
public_router = APIRouter(prefix="/api/invitations", tags=["invitations"])


class InviteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Несколько адресов сразу: людей зовут пачкой, и форма на один адрес
    #: превращает приглашение десяти человек в десять одинаковых действий.
    #: Пустой список — приглашение только по ссылке, для предъявителя.
    emails: list[EmailStr] = Field(default_factory=list, max_length=50)
    role: str
    #: Только для роли client: проекты, к которым сразу даётся доступ.
    project_ids: list[uuid.UUID] = Field(default_factory=list)
    #: Отправлять ли письма. При выключенной почте не отправляются никогда.
    send_email: bool = True


class InviteOut(BaseModel):
    id: str
    email: str | None
    role: str
    expires_at: str
    #: Ссылка показывается ровно один раз — в ответе на создание или на
    #: повторный выпуск. Сервер её не помнит: в базе лежит хеш.
    link: str | None = None
    #: Ушло ли письмо. `false` при выключенной почте и при неудаче отправки —
    #: приглашение при этом создано, и ссылку можно скопировать.
    sent: bool = False
    mail_error: str | None = None


class InvitationRow(BaseModel):
    id: str
    email: str | None
    role: str
    status: str
    created_at: str
    expires_at: str
    last_sent_at: str | None


def _membership(db: DbSession, user: User) -> Membership:
    membership = db.scalar(
        select(Membership).where(Membership.user_id == user.id).order_by(Membership.id)
    )
    if membership is None:
        raise HTTPException(status_code=403, detail="no_organization")
    return membership


def _owner(db: DbSession, user: User) -> tuple[Organization, Membership]:
    membership = _membership(db, user)
    if not can(parse_role(membership.role), Action.ORG_ADMIN):
        raise HTTPException(status_code=403, detail="forbidden")
    return db.get(Organization, membership.org_id), membership


def _refuse(error: InvitationError) -> HTTPException:
    """Отказ приглашения → отказ HTTP.

    Просроченное, отозванное и уже принятое — три разных сообщения, и код
    отказа несёт именно то, которое человек увидит. Статус один (409): все три
    означают «ссылка больше не работает», и различать их статусами значило бы
    заводить второй словарь поверх кодов.
    """
    if error.code in {"invite_not_found", "project_not_found"}:
        return HTTPException(status_code=404, detail=error.code)
    if error.code == "invite_rate_limited":
        return HTTPException(status_code=429, detail=error.code)
    if error.code in {"email_not_verified", "invite_for_another_address"}:
        return HTTPException(status_code=403, detail=error.code)
    return HTTPException(status_code=409, detail=error.code)


def _deliver(invitation: Invitation, raw_token: str) -> InviteOut:
    """Ответ с ссылкой, которую видно ровно один раз."""
    return InviteOut(
        id=str(invitation.id),
        email=invitation.email,
        role=invitation.role,
        expires_at=invitation.expires_at.isoformat(),
        link=invite_link(raw_token),
    )


def _send(
    db: DbSession,
    invitation: Invitation,
    out: InviteOut,
    org: Organization,
    inviter: User,
) -> InviteOut:
    """Отправить письмо, если есть куда и чем.

    Неудача отправки не откатывает приглашение: оно существует независимо от
    того, доставили его письмом или нет, и интерфейс честно говорит «письмо не
    ушло, скопируйте ссылку».
    """
    mailer = get_mailer()
    if invitation.email is None or not mailer.enabled:
        return out
    try:
        mailer.send(
            invitation.email,
            "invitation",
            # Язык письма — язык организации: о языке получателя пока ничего
            # не известно.
            org.default_locale,
            {
                "org": org.name,
                "inviter": inviter.name,
                "role": invitation.role,
                "link": out.link,
                "days": (invitation.expires_at - invitation.created_at).days,
            },
        )
    except MailError as error:
        return out.model_copy(update={"sent": False, "mail_error": str(error)})
    mark_sent(db, invitation)
    return out.model_copy(update={"sent": True})


@org_router.post("", response_model=list[InviteOut], status_code=201)
def create_invitations(
    payload: InviteIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    """Выпуск приглашений — по одному на каждый адрес, плюс один по ссылке.

    Роль фиксируется в момент приглашения и не может быть изменена
    принимающим.
    """
    org, _ = _owner(db, user)
    if payload.role not in INVITABLE_ROLES:
        # Роль фиксируется в момент приглашения, поэтому проверять её надо
        # здесь: принимающий изменить её уже не сможет, но и выдать владельца
        # ссылкой нельзя.
        raise HTTPException(status_code=422, detail="role_not_invitable")

    targets: list[str | None] = list(payload.emails) or [None]
    result: list[InviteOut] = []
    for email in targets:
        try:
            invitation, raw = create_invitation(
                db,
                org,
                inviter=user,
                role=payload.role,
                email=email,
                project_ids=payload.project_ids,
            )
        except InvitationError as error:
            raise _refuse(error)
        out = _deliver(invitation, raw)
        result.append(_send(db, invitation, out, org, user) if payload.send_email else out)
    db.flush()
    return result


@org_router.get("", response_model=list[InvitationRow])
def list_invitations(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    """Список приглашений организации — с состоянием, но без ссылок.

    Ссылок здесь нет и быть не может: сервер их не помнит. У непринятого
    приглашения есть кнопка «выпустить ссылку заново», которая создаёт новый
    токен и убивает прежний.
    """
    org, _ = _owner(db, user)
    rows = db.scalars(
        select(Invitation)
        .where(Invitation.org_id == org.id)
        .order_by(Invitation.created_at.desc())
    ).all()
    return [
        InvitationRow(
            id=str(row.id),
            email=row.email,
            role=row.role,
            status=status(row),
            created_at=row.created_at.isoformat(),
            expires_at=row.expires_at.isoformat(),
            last_sent_at=row.last_sent_at.isoformat() if row.last_sent_at else None,
        )
        for row in rows
    ]


def _own_invitation(db: DbSession, org: Organization, invitation_id: uuid.UUID) -> Invitation:
    invitation = db.get(Invitation, invitation_id)
    # Чужое приглашение неотличимо от несуществующего — тем же принципом, что
    # и чужой проект.
    if invitation is None or invitation.org_id != org.id:
        raise HTTPException(status_code=404, detail="invite_not_found")
    return invitation


@org_router.post("/{invitation_id}/reissue", response_model=InviteOut)
def reissue_invitation(
    invitation_id: uuid.UUID,
    send_email: bool = True,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    """Выпустить ссылку заново: новый токен, прежний умирает немедленно."""
    org, _ = _owner(db, user)
    invitation = _own_invitation(db, org, invitation_id)
    try:
        raw = reissue(db, invitation)
    except InvitationError as error:
        raise _refuse(error)

    out = _deliver(invitation, raw)
    return _send(db, invitation, out, org, user) if send_email else out


@org_router.post("/{invitation_id}/revoke", status_code=204)
def revoke_invitation(
    invitation_id: uuid.UUID,
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    org, _ = _owner(db, user)
    invitation = _own_invitation(db, org, invitation_id)
    try:
        revoke(db, invitation)
    except InvitationError as error:
        raise _refuse(error)


class InvitationPreview(BaseModel):
    org_name: str
    role: str
    #: Адрес, которому приглашение адресовано. `null` — приглашение по ссылке,
    #: оно достаётся предъявителю.
    email: str | None
    expires_at: str


@public_router.get("/{token}", response_model=InvitationPreview)
def preview(token: str, db: DbSession = Depends(get_db)):
    """Что это за приглашение — до входа и до регистрации.

    Сессии не требует намеренно: человек с ссылкой на руках должен увидеть,
    куда его зовут, прежде чем заводить аккаунт. Наружу выходит только то, что
    и так есть в письме: организация, роль и срок.
    """
    try:
        invitation = peek(db, token)
    except InvitationError as error:
        raise _refuse(error)
    org = db.get(Organization, invitation.org_id)
    return InvitationPreview(
        org_name=org.name,
        role=invitation.role,
        email=invitation.email,
        expires_at=invitation.expires_at.isoformat(),
    )


class AcceptedOut(BaseModel):
    org_id: str
    org_name: str
    role: str


@public_router.post("/{token}/accept", response_model=AcceptedOut)
def accept_invitation(
    token: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    """Приём приглашения вошедшим человеком.

    Членство появляется только после явного действия человека: никакой
    автоматической подстановки в чужую организацию по совпадению адреса.
    """
    try:
        membership = accept(db, token, user)
    except InvitationError as error:
        raise _refuse(error)
    org = db.get(Organization, membership.org_id)
    return AcceptedOut(org_id=str(org.id), org_name=org.name, role=membership.role)


# Роли, которые вообще можно выдать приглашением. Владельца — нельзя: второй
# владелец назначается отдельным действием над участником, а не ссылкой,
# уехавшей в мессенджер.
INVITABLE_ROLES = frozenset({Role.EDITOR.value, Role.VIEWER.value, Role.CLIENT.value})
