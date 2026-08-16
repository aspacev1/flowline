"""Автоперенос по связям: последователь не начинается раньше, чем кончился его
предшественник.

Правило выключено по умолчанию и включается на проекте (`auto_schedule`).
Причина не в осторожности: связь в этой системе — прежде всего картинка, и до
сих пор она не двигала ничего вовсе (см. DependencyNudge — предложение, а не
действие). Включённый автоперенос меняет смысл каждой связи в проекте разом, и
случиться это должно по решению человека, а не при обновлении.

Двигает только вперёд. Задача, между которой и её предшественником остался
запас, не подтягивается назад — даже если по связям могла бы начаться раньше.
Запас в плане чаще всего поставлен нарочно: приёмка, отпуск, окно поставки.
Автоперенос, вычищающий такие промежутки, переписывал бы план, которого никто
не просил переписывать, и делал бы это молча.

Идёт от изменённых задач вперёд по связям, а не по всему проекту: проход по
всему проекту «чинил» бы и те нарушения, которые человек оставил сознательно и
которые к его нынешней правке отношения не имеют.
"""

import uuid
from collections import deque
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.calendar import Calendar, end_date, first_working_on_or_after
from app.models import Dependency, Project, Task


def push_successors(
    db: DbSession,
    project: Project,
    cal: Calendar,
    seeds: set[uuid.UUID],
) -> dict[uuid.UUID, date]:
    """Подвинуть последователей изменённых задач. Возвращает их прежние даты.

    Прежние, а не новые: возвращённое идёт в обратную операцию, и именно оно
    вернёт план на место при отмене. Новые даты вызывающий и так видит — они
    уже в задачах.

    Кольцо невозможно (его отбивает add_dependency), но обход всё равно
    ограничен числом задач: журнал ревизий и восстановление из снимка проходят
    мимо той проверки, а зациклившийся здесь обход повесил бы запрос.
    """
    if not seeds:
        return {}

    tasks = {
        task.id: task
        for task in db.scalars(select(Task).where(Task.project_id == project.id)).all()
    }
    links: dict[uuid.UUID, list[uuid.UUID]] = {task_id: [] for task_id in tasks}
    for source, target in db.execute(
        select(Dependency.from_task_id, Dependency.to_task_id).where(
            Dependency.project_id == project.id
        )
    ).all():
        if source in links and target in tasks:
            links[source].append(target)

    was: dict[uuid.UUID, date] = {}
    queue = deque(seed for seed in seeds if seed in tasks)
    # Потолок обхода: каждая задача может встать в очередь заново, когда её
    # подвинул очередной предшественник, но не больше раза на связь.
    steps = len(tasks) * (sum(len(after) for after in links.values()) + 1) + 1

    while queue:
        steps -= 1
        if steps < 0:
            break
        current = tasks[queue.popleft()]
        finished = end_date(current.start_date, current.duration_days, cal)
        # Следующий рабочий день после окончания — самое раннее, когда работа,
        # ждущая эту задачу, может начаться.
        earliest = first_working_on_or_after(finished + timedelta(days=1), cal)

        for after_id in links[current.id]:
            after = tasks[after_id]
            if after.start_date >= earliest:
                continue
            was.setdefault(after.id, after.start_date)
            after.start_date = earliest
            queue.append(after.id)

    db.flush()
    return was


def apply_dates(db: DbSession, project: Project, dates: dict[uuid.UUID, date]) -> dict[uuid.UUID, date]:
    """Расставить даты по готовой карте. Возвращает прежние — для отмены отмены.

    Путь восстановления: карту диктует журнал, и по связям здесь не считается
    ничего — расчёт уже отработал в прямой операции. Пересчитать его заново
    значило бы получить при отмене не то состояние, из которого вышли: перенос
    вперёд обратим, а «подвинуть на самое раннее» — нет.
    """
    if not dates:
        return {}

    was: dict[uuid.UUID, date] = {}
    for task in db.scalars(
        select(Task).where(Task.project_id == project.id, Task.id.in_(dates))
    ).all():
        was[task.id] = task.start_date
        task.start_date = dates[task.id]
    db.flush()
    return was
