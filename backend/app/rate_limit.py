import time
from collections import deque
from collections.abc import Callable


class RateLimiter:
    """Скользящее окно по ключу, в памяти процесса.

    В памяти, а не в базе: ключ гостевого ограничителя — сетевой адрес, то
    есть персональные данные. Хранить их в базе ради счётчика значит завести
    хранилище персональных данных там, где достаточно счётчика.

    Плата принята сознательно: перезапуск обнуляет окна, а при нескольких
    процессах у каждого своё окно, и общий потолок умножается на их число.
    Сегодня контейнер `api` один; когда их станет больше, счётчик переедет в
    общее хранилище — но это замена одного класса, а не переделка маршрутов.

    `now` — параметр, а не вызов внутри: иначе истечение окна проверяется
    только настоящим ожиданием, и тест минутного окна идёт минуту.
    """

    def __init__(
        self,
        limit: int,
        window_seconds: float,
        now: Callable[[], float] = time.monotonic,
    ):
        self._limit = limit
        self._window = window_seconds
        self._now = now
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str) -> bool:
        moment = self._now()
        self._forget_old(moment)

        hits = self._hits.setdefault(key, deque())
        if len(hits) >= self._limit:
            # Отвергнутая попытка не записывается: иначе гость, долбящий
            # кнопку, продлевает себе запрет бесконечно — это наказание, а не
            # ограничение частоты.
            return False
        hits.append(moment)
        return True

    def tracked_keys(self) -> set[str]:
        """Ключи, за которыми ограничитель ещё следит. Для тестов: снаружи
        по нему судят о том, что память не растёт вечно."""
        return set(self._hits)

    def _forget_old(self, moment: float) -> None:
        """Чистится весь словарь, а не только запрошенный ключ: гость,
        пришедший однажды, второй раз свой ключ не трогает, и без общей уборки
        счётчик — это утечка."""
        edge = moment - self._window
        for key in list(self._hits):
            hits = self._hits[key]
            while hits and hits[0] <= edge:
                hits.popleft()
            if not hits:
                del self._hits[key]
