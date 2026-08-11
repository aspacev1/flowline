import asyncio
import uuid

import pytest

from app.live import BACKLOG_LIMIT, Hub

PROJECT = uuid.uuid4()
OTHER = uuid.uuid4()


def event(seq: int) -> dict:
    return {"type": "revision", "seq": seq}


@pytest.mark.asyncio
async def test_subscriber_gets_what_was_published_to_its_room():
    hub = Hub()
    with hub.subscribe(PROJECT) as subscriber:
        await hub.publish(PROJECT, event(1))
        assert await subscriber.next() == event(1)


@pytest.mark.asyncio
async def test_a_room_hears_nothing_of_another_project():
    """Без второй комнаты тест проходил бы и с рассылкой всем подряд."""
    hub = Hub()
    with hub.subscribe(PROJECT) as mine, hub.subscribe(OTHER) as theirs:
        await hub.publish(PROJECT, event(1))

        assert await mine.next() == event(1)
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(theirs.next(), timeout=0.05)


@pytest.mark.asyncio
async def test_everyone_in_the_room_gets_the_same_event():
    hub = Hub()
    with hub.subscribe(PROJECT) as first, hub.subscribe(PROJECT) as second:
        await hub.publish(PROJECT, event(7))

        assert await first.next() == event(7)
        assert await second.next() == event(7)


@pytest.mark.asyncio
async def test_leaving_removes_the_room():
    """Комната обязана исчезать, а не оставаться пустой навсегда."""
    hub = Hub()
    with hub.subscribe(PROJECT):
        assert hub.listeners(PROJECT) == 1
    assert hub.listeners(PROJECT) == 0

    # И публикация в опустевшую комнату не должна ничего ломать.
    await hub.publish(PROJECT, event(1))


@pytest.mark.asyncio
async def test_a_subscriber_that_falls_behind_is_marked_and_stops_growing():
    hub = Hub()
    with hub.subscribe(PROJECT) as subscriber:
        for seq in range(BACKLOG_LIMIT + 10):
            await hub.publish(PROJECT, event(seq))

        assert subscriber.lagging is True
        # Очередь не выросла за потолок: лишнее выброшено, а не накоплено.
        for seq in range(BACKLOG_LIMIT):
            assert await subscriber.next() == event(seq)
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(subscriber.next(), timeout=0.05)


@pytest.mark.asyncio
async def test_lagging_survives_a_drained_queue():
    """Отставание — не «очередь полна сейчас», а «лента уже порвана».

    Иначе сокет, у которого очередь успела опустеть, продолжил бы получать
    ревизии с дырой посередине и считал бы себя в курсе.
    """
    hub = Hub()
    with hub.subscribe(PROJECT) as subscriber:
        for seq in range(BACKLOG_LIMIT + 1):
            await hub.publish(PROJECT, event(seq))
        for _ in range(BACKLOG_LIMIT):
            await subscriber.next()

        await hub.publish(PROJECT, event(999))
        assert subscriber.lagging is True
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(subscriber.next(), timeout=0.05)
