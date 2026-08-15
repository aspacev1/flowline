"""Относительный план и его привязка к календарной дате старта.

Относительный план не привязан к настоящим датам: у задач есть смещение от
начала проекта в рабочих днях, длительность и связи, а шкала читается как
«Месяц 1 / Неделя 1 / День 1». Хранится смещение при этом не отдельной
колонкой, а той же `Task.start_date` — координатой на относительной оси:

    день N проекта  =  RELATIVE_EPOCH + (N - 1) календарных дней.

RELATIVE_EPOCH — понедельник, поэтому «Неделя 1» начинается с понедельника, а
маска рабочей недели ложится на относительную ось без поправок. Праздники в
относительном режиме не применяются осознанно: праздник — свойство настоящей
даты, которой у плана ещё нет, и календарь относительного проекта состоит из
одной недельной маски (см. relative_calendar).

Почему координата, а не колонка со смещением: смещение и координата взаимно
однозначны при фиксированной маске, но координатой уже говорят журнал ревизий,
отмена, порог сдвига, снимки плана и весь клиент. Вторая колонка с тем же
содержанием была бы вторым представлением одного и того же — и однажды
разошлась бы с первым.

Привязка к дате старта переводит план в календарный режим без дрейфа:
координата каждой задачи читается как смещение в рабочих днях от эпохи, и то
же смещение откладывается от назначенного старта уже по настоящему календарю —
с выходными и праздниками. Источник истины и до, и после — старт + длительности
+ связи + рабочий календарь, а не дата окончания.
"""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.calendar import Calendar, count_working_days, end_date, first_working_on_or_after
from app.models import Organization, Project, ScheduleMode, Task
from app.settings_resolution import project_calendar, resolve_working_days

#: Начало относительной оси. Понедельник — чтобы «День 1» открывал «Неделю 1»,
#: а маска рабочей недели совпадала с колонками сетки. Год взят заведомо
#: раньше любого настоящего плана: относительная координата не должна быть
#: перепутана с настоящей датой даже глазами.
RELATIVE_EPOCH = date(2001, 1, 1)


def relative_calendar(project: Project, org: Organization) -> Calendar:
    """Календарь относительной оси: одна недельная маска, без праздников.

    Праздники и объявленные рабочие дни — свойства настоящих дат; на оси,
    где дат ещё нет, им не на что лечь (настроенные в организации даты
    настоящих лет с координатами 2001 года и не пересеклись бы — но правило
    здесь по смыслу, а не по совпадению диапазонов).
    """
    return Calendar(working_days=resolve_working_days(project, org))


def offset_of(coordinate: date, anchor: date, cal: Calendar) -> int:
    """Смещение задачи от якоря в рабочих днях, начиная с нуля.

    Старт на нерабочем дне читается как ближайший рабочий после него — ровно
    так же, как его читает расчёт даты окончания (см. calendar.end_date):
    смещение обязано называть тот день, в который работа и начнётся.

    Для координаты раньше якоря смещения в рабочих днях нет — вызывающий
    решает сам (см. _shifted_dates); здесь это ValueError, как и в
    count_working_days.
    """
    started = first_working_on_or_after(coordinate, cal)
    return count_working_days(anchor, started, cal) - 1


def date_at_offset(anchor: date, offset: int, cal: Calendar) -> date:
    """Дата, отстоящая от якоря на `offset` рабочих дней (ноль — первый
    рабочий день на якоре или после него).

    Тот же счёт, что у длительности: `offset + 1`-й рабочий день отрезка,
    начатого на якоре. Отдельное имя, потому что вопрос другой — «где стоит
    задача», а не «когда кончится».
    """
    return end_date(anchor, offset + 1, cal)


@dataclass(frozen=True)
class SchedulePlan:
    """Результат пересчёта плана к новой дате старта — до его применения.

    Держит новые старты по задачам и итоговые границы: предпросмотр
    показывает их человеку до подтверждения, применение — записывает.
    """

    start_date: date
    #: Конец проекта по новым датам; None у проекта без задач.
    end_date: date | None
    #: Новые старты задач по их идентификаторам.
    starts: dict[uuid.UUID, date]
    #: Новые базовые старты — только у задач, где базовый план есть.
    baseline_starts: dict[uuid.UUID, date]


def _project_tasks(db: DbSession, project: Project) -> list[Task]:
    return list(
        db.scalars(
            select(Task).where(Task.project_id == project.id).order_by(Task.position, Task.id)
        ).all()
    )


def _shifted_dates(
    tasks: list[Task],
    *,
    old_anchor: date,
    old_cal: Calendar,
    new_anchor: date,
    new_cal: Calendar,
) -> SchedulePlan:
    """Переносит каждую задачу со старой оси на новую, сохраняя смещение в
    рабочих днях от якоря.

    Задача, начатая раньше якоря (в календарном проекте так бывает после
    ручных переносов), сдвигается на календарную разницу якорей: смещения в
    рабочих днях у неё нет, а терять её взаимное положение с началом проекта
    нельзя.
    """
    calendar_delta = (new_anchor - old_anchor).days

    def carried(coordinate: date) -> date:
        if coordinate < old_anchor:
            return coordinate + calendar_delta
        return date_at_offset(new_anchor, offset_of(coordinate, old_anchor, old_cal), new_cal)

    starts: dict[uuid.UUID, date] = {}
    baseline_starts: dict[uuid.UUID, date] = {}
    ends: list[date] = []
    for task in tasks:
        starts[task.id] = carried(task.start_date)
        ends.append(end_date(starts[task.id], task.duration_days, new_cal))
        if task.baseline_start is not None and task.baseline_duration is not None:
            baseline_starts[task.id] = carried(task.baseline_start)

    return SchedulePlan(
        start_date=new_anchor,
        end_date=max(ends) if ends else None,
        starts=starts,
        baseline_starts=baseline_starts,
    )


def _current_anchor(project: Project, tasks: list[Task]) -> date:
    """Точка, от которой читаются смещения текущего плана.

    В относительном режиме это эпоха. В календарном — назначенный старт, а у
    проекта, календарного с рождения (созданного до появления режимов), —
    самый ранний старт задачи: другого начала у него нет.
    """
    if project.schedule_mode == ScheduleMode.RELATIVE:
        return RELATIVE_EPOCH
    if project.start_date is not None:
        return project.start_date
    return min((task.start_date for task in tasks), default=RELATIVE_EPOCH)


def _source_calendar(project: Project, org: Organization) -> Calendar:
    if project.schedule_mode == ScheduleMode.RELATIVE:
        return relative_calendar(project, org)
    return project_calendar(project, org)


def planned_schedule(
    db: DbSession,
    project: Project,
    org: Organization,
    *,
    start: date,
    working_days: int | None = None,
    shift_tasks: bool = True,
) -> SchedulePlan:
    """Считает, где встанут задачи после привязки к дате старта, не меняя их.

    `working_days` — маска новой рабочей недели, если человек выбрал её в том
    же окне; None — оставить действующую. Смещения при этом читаются по
    старому календарю (план рисовали под ним), а раскладываются — по новому.

    `shift_tasks=False` — вариант «оставить даты как есть» при повторной
    смене старта календарного проекта: задачи стоят, меняется только якорь
    (и, возможно, календарь — от него пересчитываются даты окончания). Для
    относительного проекта варианта «как есть» не существует: без пересчёта
    его координаты остались бы на относительной оси.
    """
    tasks = _project_tasks(db, project)
    current = project_calendar(project, org)
    target = Calendar(
        working_days=working_days if working_days is not None else current.working_days,
        holidays=current.holidays,
        extra_workdays=current.extra_workdays,
    )

    if project.schedule_mode == ScheduleMode.CALENDAR and not shift_tasks:
        ends = [end_date(task.start_date, task.duration_days, target) for task in tasks]
        return SchedulePlan(
            start_date=start,
            end_date=max(ends) if ends else None,
            starts={task.id: task.start_date for task in tasks},
            baseline_starts={},
        )

    return _shifted_dates(
        tasks,
        old_anchor=_current_anchor(project, tasks),
        old_cal=_source_calendar(project, org),
        new_anchor=start,
        new_cal=target,
    )


def apply_schedule(
    db: DbSession,
    project: Project,
    org: Organization,
    *,
    start: date,
    working_days: int | None = None,
    shift_tasks: bool = True,
) -> SchedulePlan:
    """Назначает дату старта: записывает её, переводит проект в календарный
    режим и раскладывает задачи по настоящему календарю.

    Смещения, длительности и связи сохраняются — меняется только ось, на
    которой они отложены. Вместе со стартами переезжают и базовые планы:
    обещание, данное в относительных днях, после привязки обязано стоять на
    тех же рабочих днях от старта, иначе весь план разом оказался бы «со
    сдвигом» без единой правки.

    `shift_tasks=False` — перенос даты старта без пересчёта задач («оставить
    даты как есть»): выбор человека при повторной смене старта уже
    календарного проекта. Для относительного проекта выбора нет — без
    пересчёта его координаты остались бы в 2001 году.

    Снимки прежних версий плана (PlanVersion.snapshot) остаются как были:
    это летопись обещаний в той оси, в которой их давали.

    Через журнал ревизий не проходит — как и правки настроек: это смена
    системы отсчёта, а не правка плана, и записи «подвинуты все задачи»
    журнал бы не отменил одной кнопкой.
    """
    plan = planned_schedule(
        db, project, org, start=start, working_days=working_days, shift_tasks=shift_tasks
    )

    if working_days is not None:
        project.working_days = working_days

    if project.schedule_mode == ScheduleMode.RELATIVE or shift_tasks:
        for task in _project_tasks(db, project):
            task.start_date = plan.starts[task.id]
            moved_baseline = plan.baseline_starts.get(task.id)
            if moved_baseline is not None:
                task.baseline_start = moved_baseline

    project.start_date = start
    project.schedule_mode = ScheduleMode.CALENDAR
    db.flush()
    return plan
