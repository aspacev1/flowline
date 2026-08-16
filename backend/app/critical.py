"""Критический путь: задачи, у которых нет запаса.

Критическая задача — та, чей сдвиг на день сдвигает окончание всего проекта.
Это единственный вопрос, на который диаграмма без такого расчёта не отвечает
вовсе: полоски видно все, а какая из них держит срок — ни одной.

Считается здесь, а не на клиенте, по той же причине, по которой сервер считает
дату окончания: запас меряется рабочими днями, а рабочий календарь — свойство
проекта, и второй его расчёт в браузере разошёлся бы с первым на первом же
празднике.

Считается полный запас (total float), а не свободный: свободный отвечает
«насколько сдвинуть задачу, не тронув соседнюю», а спрашивают всегда о сроке
проекта. Ноль полного запаса и есть критичность.

Прямого прохода здесь нет намеренно. Ранние даты уже известны — это `start_date`
и `end_date` задачи, — и строить поверх них план «как было бы, если бы всё
начиналось как можно раньше» значило бы показать критическим то, чего на
диаграмме нет: даты назначены человеком, а не вычислены.
"""

import uuid
from collections.abc import Iterable, Mapping
from datetime import date

from app.calendar import Calendar, count_working_days


def _slack(finished: date, starts: date, cal: Calendar) -> int:
    """Рабочих дней простоя между окончанием одной задачи и началом другой.

    Ноль — вторая начинается на следующий же рабочий день. Отрицательного не
    бывает: задача, начатая раньше, чем кончился её блокировщик, — нарушенная
    связь, а не отрицательный запас. Запас у неё нулевой, и на критическом пути
    она окажется первой же, что и правильно: чинить надо именно её.
    """
    if starts <= finished:
        return 0
    return max(0, count_working_days(finished, starts, cal) - 2)


def critical_tasks(
    starts: Mapping[uuid.UUID, date],
    ends: Mapping[uuid.UUID, date],
    dependencies: Iterable[tuple[uuid.UUID, uuid.UUID]],
    cal: Calendar,
) -> set[uuid.UUID]:
    """Идентификаторы задач без запаса.

    Пустой проект критического пути не имеет: держать нечего.

    Кольцо в связях невозможно — его отбивает `add_dependency`, — но полагаться
    на это как на единственную защиту нельзя: журнал ревизий и восстановление из
    снимка проходят мимо той проверки. Поэтому обход считает степени и
    останавливается на том, что разобралось: задача, попавшая в кольцо, просто
    не получит запаса и критической не станет. Молчаливая неполнота здесь лучше
    бесконечного цикла в ответе на GET проекта.
    """
    if not starts:
        return set()

    successors: dict[uuid.UUID, list[uuid.UUID]] = {task: [] for task in starts}
    # Сколько последователей задачи ещё не разобрано. Обратный проход берёт
    # задачу только тогда, когда счётчик дошёл до нуля: запас считается по
    # запасам тех, кто идёт следом, и по половине их он был бы неверен.
    pending: dict[uuid.UUID, int] = {task: 0 for task in starts}
    predecessors: dict[uuid.UUID, list[uuid.UUID]] = {task: [] for task in starts}

    for source, target in dependencies:
        # Связь переживает задачу ровно на один ответ сервера: состояние могли
        # собрать в тот же миг, когда сосед удалил задачу.
        if source not in successors or target not in successors:
            continue
        successors[source].append(target)
        predecessors[target].append(source)
        pending[source] += 1

    project_end = max(ends[task] for task in starts)

    floats: dict[uuid.UUID, int] = {}
    queue = [task for task, left in pending.items() if left == 0]

    while queue:
        task = queue.pop()
        after = successors[task]
        floats[task] = (
            min(_slack(ends[task], starts[nxt], cal) + floats[nxt] for nxt in after)
            if after
            # Хвост цепочки держит срок проекта напрямую: его запас — это
            # расстояние от его окончания до окончания проекта.
            else max(0, count_working_days(ends[task], project_end, cal) - 1)
        )

        for before in predecessors[task]:
            pending[before] -= 1
            if pending[before] == 0:
                queue.append(before)

    return {task for task, slack in floats.items() if slack == 0}
