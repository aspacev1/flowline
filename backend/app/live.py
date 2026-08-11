"""Рассылка ревизий подключённым клиентам.

Комнаты живут в памяти процесса. Пока сервер один, этого достаточно; когда
понадобится второй, здесь меняется один класс, а маршруты и мутации не узнают
об этом ничего — ради этого модуль и не знает ни про HTTP, ни про сокеты, ни
про то, что за словари он развозит.
"""

import asyncio
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

# Сколько сообщений держать для подписчика, который не успевает их забирать.
# Потолок нужен не ради памяти, а ради честности: тот, кто отстал на сотню
# ревизий, всё равно не сможет догнать ленту по кусочкам — ему проще
# перечитать проект целиком (§12), и очередь, растущая без предела, лишь
# оттягивает этот момент, накапливая заведомо ненужное.
BACKLOG_LIMIT = 128


class Subscriber:
    """Одно подключение: очередь того, что ему ещё не отдали.

    Отставание помечается флагом, а не исключением в момент публикации:
    публикует хаб, а расплачиваться за отставание должен тот, кто отстал, —
    иначе один залипший сокет ронял бы рассылку всем остальным.
    """

    def __init__(self) -> None:
        self._queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=BACKLOG_LIMIT)
        self.lagging = False

    def offer(self, message: dict) -> None:
        if self.lagging:
            return
        try:
            self._queue.put_nowait(message)
        except asyncio.QueueFull:
            self.lagging = True

    async def next(self) -> dict:
        return await self._queue.get()


class Hub:
    """Комнаты по проектам."""

    def __init__(self) -> None:
        self._rooms: dict[uuid.UUID, set[Subscriber]] = {}

    @contextmanager
    def subscribe(self, project_id: uuid.UUID) -> Iterator[Subscriber]:
        """Подписка на время блока.

        Контекстный менеджер, а не пара subscribe/unsubscribe: сокет
        закрывается и по ошибке, и по отмене задачи, и забытая отписка в одной
        из этих веток — это комната, которая никогда не опустеет.
        """
        subscriber = Subscriber()
        self._rooms.setdefault(project_id, set()).add(subscriber)
        try:
            yield subscriber
        finally:
            room = self._rooms.get(project_id)
            if room is not None:
                room.discard(subscriber)
                # Пустая комната удаляется: иначе словарь растёт по одному
                # ключу на каждый проект, который кто-нибудь когда-нибудь
                # открывал, и не уменьшается никогда.
                if not room:
                    del self._rooms[project_id]

    async def publish(self, project_id: uuid.UUID, message: dict) -> None:
        """Разложить сообщение по очередям комнаты.

        Корутина, хотя внутри ничего не ждёт. Это не украшение: рассылку
        запускает фоновая задача Starlette, а та выполняет обычную функцию в
        пуле потоков — и `asyncio.Queue` из чужого потока трогать нельзя.
        Объявленная корутиной, она гарантированно исполняется в цикле событий.

        Копия множества, а не оно само: подписчик может отвалиться прямо во
        время обхода, и тогда набор изменится под ногами.
        """
        for subscriber in tuple(self._rooms.get(project_id, ())):
            subscriber.offer(message)

    def listeners(self, project_id: uuid.UUID) -> int:
        """Сколько сокетов слушает проект. Нужно тестам и диагностике."""
        return len(self._rooms.get(project_id, ()))


hub = Hub()
