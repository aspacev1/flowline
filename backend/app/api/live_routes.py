import asyncio
import time
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, WebSocket
from sqlalchemy.orm import Session as DbSession
from starlette.websockets import WebSocketDisconnect

from app.access import Action, can, parse_role, visible_op
from app.api.deps import project_granted as has_project_grant
from app.auth import SESSION_COOKIE, session_for_token
from app.config import get_settings
from app.db import SessionLocal
from app.live import Subscriber, hub
from app.models import Project, Role
from app.orgs import active_membership

router = APIRouter(tags=["live"])

# Коды закрытия из диапазона, отведённого приложению (4000–4999). Стандартный
# 1008 «нарушение политики» одинаков и для «не представился», и для «нет такого
# проекта», а клиенту они разные: на первом переподключаться бессмысленно, на
# втором — тем более, зато на разрыве связи обязательно.
CLOSE_UNAUTHENTICATED = 4401
CLOSE_NOT_FOUND = 4404
CLOSE_LAGGING = 4409

# Как часто напоминать о себе, когда в проекте ничего не происходит. Нужно не
# серверу, а клиенту: половина обрывов — это не закрытое соединение, а
# замолчавшее (уснувший ноутбук, сменившаяся сеть), и отличить такое от тишины
# в проекте можно только по отсутствию ожидаемого сообщения.
HEARTBEAT_SECONDS = 25

HEARTBEAT = {"type": "heartbeat"}

# Как часто перепроверять, что подписчику всё ещё можно читать проект. Сокет
# живёт часами, а право за это время отзывают: человека выводят из
# организации, сессию закрывают «выйти на всех устройствах». Проверять на
# каждом сообщении — поход в базу на каждую ревизию каждому читателю;
# раз в минуту — самое большее минута жизни отозванного доступа.
RECHECK_SECONDS = 60.0


def _origin_allowed(websocket: WebSocket) -> bool:
    """Пришло ли рукопожатие со своей страницы.

    Кука уезжает с WebSocket-рукопожатием с любого сайта: SameSite=Lax
    считает его top-level навигацией. Без проверки Origin чужая страница
    открывает сокет от имени залогиненного посетителя и читает живую ленту
    его проекта. Браузер Origin подделать не даёт; запрос без Origin — не
    браузер, ему CSRF не грозит (кука сама не подставится), поэтому
    отсутствие заголовка — проход.
    """
    origin = websocket.headers.get("origin")
    if origin is None:
        return True
    source = urlsplit(origin).hostname
    if source is None:
        return False
    allowed = {
        urlsplit(f"//{websocket.headers.get('host', '')}").hostname,
        urlsplit(f"//{websocket.headers.get('x-forwarded-host', '')}").hostname,
        urlsplit(get_settings().public_base_url).hostname,
    }
    allowed.discard(None)
    return source.lower() in allowed


def db_scope() -> Callable[[], AbstractContextManager[DbSession]]:
    """Фабрика короткоживущей сессии базы.

    Не `Depends(get_db)`, как в обычных маршрутах, и это не мелочь: та сессия
    живёт столько, сколько живёт обработчик, а обработчик сокета живёт ровно
    столько, сколько открыта вкладка. Соединение из пула, занятое каждым
    открытым проектом, кончилось бы на полутора десятках читателей — и не
    из-за нагрузки, а из-за того, что все они просто смотрят.

    Отдельная зависимость, а не прямой вызов SessionLocal, — чтобы тесту было
    что подменить.
    """
    return SessionLocal


def _for_role(message: dict, role: Role | str | None, granted: bool) -> dict:
    """Сообщение в том виде, в каком его вправе увидеть этот подписчик.

    Фильтруется на выходе к конкретному сокету, а не на входе в комнату: в
    одной комнате сидят и редактор, и клиент, и внутренняя заметка обязана
    доехать до первого и не доехать до второго.
    """
    if message.get("type") != "revision":
        return message
    return {**message, "op": visible_op(message["op"], role, project_granted=granted)}


async def _refuse(websocket: WebSocket, code: int) -> None:
    """Отказать так, чтобы клиент узнал причину.

    accept() перед close() — не церемония. Сокет, закрытый до принятия, — это
    несостоявшееся рукопожатие, и браузеру достаётся код 1006, одинаковый и для
    «не пущу», и для «сеть отвалилась»: клиент обречён переподключаться туда,
    куда его не пустят никогда. Приняв и немедленно закрыв, сервер доносит свой
    код. Отправлено при этом не бывает ничего — отказавший узнаёт ровно то же,
    что сказал бы ему тот же запрос по HTTP.
    """
    await websocket.accept()
    await websocket.close(code=code)


async def _drain(websocket: WebSocket) -> None:
    """Читает и выбрасывает всё, что скажет клиент.

    По этому сокету клиент не говорит ничего: единственный способ изменить
    проект — POST мутации, где проверяется право. Но читать всё равно
    необходимо — уведомление о разрыве приходит той же дорогой, что и данные,
    и обработчик, который только пишет, узнаёт о закрытой вкладке лишь тогда,
    когда сам захочет что-нибудь отправить.
    """
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            return


async def _pump(
    websocket: WebSocket,
    subscriber: Subscriber,
    role: Role | str | None,
    granted: bool,
    still_allowed: Callable[[], bool] | None = None,
) -> None:
    reader = asyncio.create_task(_drain(websocket))
    last_recheck = time.monotonic()
    try:
        while True:
            incoming = asyncio.create_task(subscriber.next())
            done, _ = await asyncio.wait(
                {reader, incoming},
                timeout=HEARTBEAT_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )

            if reader in done:
                # Клиент ушёл. Отмена ожидания очереди безопасна: сообщение,
                # если оно уже положено, остаётся в очереди, а очередь уходит
                # вместе с подпиской.
                incoming.cancel()
                return

            # Переавторизация: и перед рассылкой, и на пустом ходу — сокет,
            # которому больше нельзя, закрывается не позже RECHECK_SECONDS
            # после отзыва права, а не «когда-нибудь при перезагрузке».
            if still_allowed is not None and time.monotonic() - last_recheck >= RECHECK_SECONDS:
                last_recheck = time.monotonic()
                if not still_allowed():
                    incoming.cancel()
                    await websocket.close(code=CLOSE_UNAUTHENTICATED)
                    return

            if incoming not in done:
                incoming.cancel()
                await websocket.send_json(HEARTBEAT)
                continue

            if subscriber.lagging:
                # Отставшему нельзя досылать обрывок ленты: он применил бы
                # часть изменений и считал бы себя в курсе. Закрываем —
                # клиент переподключится и перечитает проект целиком (§12).
                await websocket.close(code=CLOSE_LAGGING)
                return

            await websocket.send_json(_for_role(incoming.result(), role, granted))
    except WebSocketDisconnect:
        return
    finally:
        reader.cancel()


@router.websocket("/api/projects/{project_id}/live")
async def project_live(
    websocket: WebSocket,
    project_id: uuid.UUID,
    session_scope: Callable[[], AbstractContextManager[DbSession]] = Depends(db_scope),
):
    """Живая лента проекта: ревизии по мере их появления.

    Права проверяются один раз, при подключении. Роль, изменившаяся за время
    жизни сокета, догонит человека при следующей перезагрузке страницы: делать
    из этого повод перепроверять членство на каждой ревизии значило бы ходить
    в базу на каждое сообщение каждому читателю.
    """
    # Origin — до всего остального: чужой странице не положено даже узнать,
    # есть ли у посетителя сессия.
    if not _origin_allowed(websocket):
        await _refuse(websocket, CLOSE_UNAUTHENTICATED)
        return

    token = websocket.cookies.get(SESSION_COOKIE)
    with session_scope() as db:
        session = session_for_token(db, token)
        if session is None:
            await _refuse(websocket, CLOSE_UNAUTHENTICATED)
            return

        # Организация — та же, что и в HTTP: выбранная переключателем, а не
        # первая попавшаяся. Иначе человек, переключившийся на вторую
        # организацию, слушал бы проект в первой.
        membership = active_membership(db, session)
        project = None if membership is None else db.get(Project, project_id)
        if project is not None and project.org_id != membership.org_id:
            project = None
        role = None if membership is None else parse_role(membership.role)
        scoped = membership is not None and membership.project_scoped
        granted = project is not None and has_project_grant(db, project.id, session.user_id)
        # Отказ в чтении — то же закрытие, что и «нет такого проекта», по тому
        # же принципу, что и 404 вместо 403 в HTTP-маршрутах: тот, кому проект
        # не показывают, не должен узнать, что он существует. Роль, которую
        # зовут в проекты поимённо (или чьё членство сужено), без выданного
        # доступа сюда не попадает.
        if project is None or not can(role, Action.PROJECT_READ, project_granted=granted, scoped=scoped):
            await _refuse(websocket, CLOSE_NOT_FOUND)
            return

    def still_allowed() -> bool:
        """Право читать проект, проверенное заново, — для переавторизации.

        Короткая сессия базы на каждую проверку — тем же приёмом, что и при
        подключении: держать соединение из пула под живущим часами сокетом
        нельзя, а раз в минуту открыть и закрыть — не стоит ничего.
        """
        with session_scope() as db:
            fresh = session_for_token(db, token)
            if fresh is None:
                return False
            membership = active_membership(db, fresh)
            if membership is None:
                return False
            current = db.get(Project, project_id)
            if current is None or current.org_id != membership.org_id:
                return False
            return can(
                parse_role(membership.role),
                Action.PROJECT_READ,
                project_granted=has_project_grant(db, project_id, fresh.user_id),
                scoped=membership.project_scoped,
            )

    # Сессия закрыта до accept(): дальше обработчик только ждёт, и держать за
    # этим ожиданием соединение с базой не за что.
    await websocket.accept()
    with hub.subscribe(project_id) as subscriber:
        await _pump(websocket, subscriber, role, granted, still_allowed)
