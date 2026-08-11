"""Приглашения: выпуск, приём, отзыв, повторная отправка.

Правила раздела 2 живут здесь, а не в маршруте, по той же причине, по которой
там живут мутации: приглашение принимают и по ссылке из письма, и по ссылке из
мессенджера, и из формы регистрации — а правило одно.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.models import (
    Invitation,
    Membership,
    Organization,
    Project,
    ProjectAccess,
    Role,
    User,
)
from app.security import hash_token, new_token
from app.text import normalize_email


class InvitationError(Exception):
    """Отказ, названный машинным кодом.

    Кодов у приглашения нарочно несколько, а не один «ссылка недействительна»:
    человек должен понимать, просить ли новую ссылку или он уже в системе и
    достаточно войти.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(moment: datetime) -> datetime:
    """Время из базы — в осознанном виде.

    SQLite и часть драйверов возвращают naive datetime даже из колонки с
    часовым поясом, и сравнение с now(timezone.utc) на нём падает. Считаем
    такое время UTC: именно в нём оно и записывалось.
    """
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def invite_link(token: str) -> str:
    return f"{get_settings().public_base_url.rstrip('/')}/invite/{token}"


def _check_rate_limit(db: DbSession, org: Organization) -> None:
    """Потолок приглашений в час на организацию.

    Без него приложение превращается в бесплатный рассыльщик писем с чужого
    домена — и домен отправителя быстро оказывается в чёрных списках.
    Считаются все выпущенные приглашения, а не только отправленные письмом:
    ограничивается выпуск ссылок, а не работа почты.
    """
    limit = get_settings().invite_rate_limit
    since = _now() - timedelta(hours=1)
    recent = db.scalar(
        select(func.count())
        .select_from(Invitation)
        .where(Invitation.org_id == org.id, Invitation.created_at >= since)
    )
    if recent >= limit:
        raise InvitationError("invite_rate_limited", f"больше {limit} приглашений в час нельзя")


def _check_projects(db: DbSession, org: Organization, project_ids: list[uuid.UUID]) -> None:
    """Проекты из приглашения обязаны принадлежать этой организации.

    Иначе владелец одной организации выдавал бы доступ к чужим проектам,
    просто подставив их идентификаторы.
    """
    if not project_ids:
        return
    found = db.scalars(
        select(Project.id).where(Project.org_id == org.id, Project.id.in_(project_ids))
    ).all()
    if len(set(found)) != len(set(project_ids)):
        raise InvitationError("project_not_found", "проект не найден в этой организации")


def create_invitation(
    db: DbSession,
    org: Organization,
    *,
    inviter: User,
    role: str,
    email: str | None = None,
    project_ids: list[uuid.UUID] | None = None,
) -> tuple[Invitation, str]:
    """Выпускает приглашение и возвращает его вместе с сырым токеном.

    Сырой токен возвращается ровно один раз и нигде не сохраняется: в базе
    лежит его хеш. Альтернатива — хранить токен в расшифровываемом виде ради
    возможности скопировать позже — экономит один клик и превращает дамп базы
    в набор действующих ключей от всех организаций.
    """
    if role not in {member.value for member in Role}:
        raise InvitationError("unknown_role", f"неизвестная роль: {role}")

    settings = get_settings()
    # Подтверждение адреса спрашивается, только если в установке настроена
    # почта: иначе установка без почтового сервера превращается в
    # неработающую, а это ровно тот сценарий, ради которого проект и
    # самохостится.
    if settings.mail_transport != "none" and inviter.email_verified_at is None:
        raise InvitationError("email_not_verified", "сначала подтвердите свой адрес")

    _check_rate_limit(db, org)
    projects = list(project_ids or [])
    _check_projects(db, org, projects)

    raw, hashed = new_token()
    invitation = Invitation(
        org_id=org.id,
        email=normalize_email(email) if email else None,
        role=role,
        # Проекты запоминаются только для роли client: остальные и так видят
        # все проекты организации, и список у них означал бы обещание
        # ограничения, которого нет.
        project_ids=[str(item) for item in projects] if role == Role.CLIENT else [],
        token_hash=hashed,
        invited_by=inviter.id,
        expires_at=_now() + timedelta(days=settings.invite_ttl_days),
    )
    db.add(invitation)
    db.flush()
    return invitation, raw


def reissue(db: DbSession, invitation: Invitation) -> str:
    """Новый токен взамен прежнего.

    Прежний умирает немедленно — иначе отозвать «то самое старое письмо»
    становится невозможно, и отправленная год назад ссылка продолжает пускать
    в организацию.
    """
    _require_open(invitation)
    raw, hashed = new_token()
    invitation.token_hash = hashed
    invitation.expires_at = _now() + timedelta(days=get_settings().invite_ttl_days)
    db.flush()
    return raw


def revoke(db: DbSession, invitation: Invitation) -> None:
    _require_open(invitation)
    invitation.revoked_at = _now()
    db.flush()


def _require_open(invitation: Invitation) -> None:
    """Три разных отказа, а не один «ссылка недействительна»."""
    if invitation.accepted_at is not None:
        raise InvitationError("invite_accepted", "приглашение уже принято")
    if invitation.revoked_at is not None:
        raise InvitationError("invite_revoked", "приглашение отозвано")
    if _as_utc(invitation.expires_at) < _now():
        raise InvitationError("invite_expired", "срок приглашения истёк")


def status(invitation: Invitation) -> str:
    """Состояние приглашения для списка участников.

    Просроченное вычисляется, а не хранится: хранимый признак пришлось бы
    кем-то проставлять, и приглашение оставалось бы «живым» ровно до тех пор,
    пока этот кто-то не пришёл.
    """
    if invitation.accepted_at is not None:
        return "accepted"
    if invitation.revoked_at is not None:
        return "revoked"
    if _as_utc(invitation.expires_at) < _now():
        return "expired"
    return "pending"


def mark_sent(db: DbSession, invitation: Invitation) -> None:
    invitation.last_sent_at = _now()
    db.flush()


def find(db: DbSession, token: str) -> Invitation:
    invitation = db.scalar(
        select(Invitation).where(Invitation.token_hash == hash_token(token))
    )
    if invitation is None:
        raise InvitationError("invite_not_found", "приглашение не найдено")
    return invitation


def peek(db: DbSession, token: str) -> Invitation:
    """Приглашение для показа на экране приёма: кто зовёт, куда и кем."""
    invitation = find(db, token)
    _require_open(invitation)
    return invitation


def accept(db: DbSession, token: str, user: User) -> Membership:
    """Приём приглашения вошедшим человеком.

    Роль берётся из приглашения и не может быть изменена принимающим: ссылка
    на `viewer` не превращается в `editor`, как бы её ни открывали.
    """
    invitation = find(db, token)
    _require_open(invitation)

    # Адрес привязывает приглашение: вошедшему под другим аккаунтом система
    # прямо говорит, кому оно адресовано, и предлагает выйти. Сравнение по
    # нормализованной форме, а не по collation базы, — та зависит от локали.
    if invitation.email is not None and invitation.email != normalize_email(user.email):
        raise InvitationError("invite_for_another_address", "приглашение адресовано другому")

    existing = db.scalar(
        select(Membership).where(
            Membership.org_id == invitation.org_id, Membership.user_id == user.id
        )
    )
    if existing is not None:
        # Второй раз в ту же организацию не зовут. Приглашение при этом
        # гасится: оно своё дело сделало, и оставлять его живым значило бы
        # держать работающую ссылку неизвестно у кого.
        membership = existing
    else:
        membership = Membership(
            org_id=invitation.org_id, user_id=user.id, role=invitation.role
        )
        db.add(membership)

    if invitation.role == Role.CLIENT:
        for raw_id in invitation.project_ids or []:
            project_id = uuid.UUID(raw_id)
            granted = db.scalar(
                select(ProjectAccess).where(
                    ProjectAccess.project_id == project_id, ProjectAccess.user_id == user.id
                )
            )
            if granted is None:
                db.add(ProjectAccess(project_id=project_id, user_id=user.id))

    # Принятое приглашение немедленно мертво: ссылку нельзя переиспользовать,
    # переслав дальше.
    invitation.accepted_at = _now()
    invitation.accepted_by = user.id
    db.flush()
    return membership
