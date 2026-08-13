import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.models import PlanVersion, Project, Task


def deviation_days(
    task: Task, *, start_date: date | None = None, duration_days: int | None = None
) -> int | None:
    """Отклонение задачи от её базового плана, в днях.

    ``None`` означает, что базового плана у задачи нет: она создана после
    утверждения и от объяснений освобождена — добавление работы нормально,
    скрытый перенос сроков нет.

    Считается от базового плана, а не от предыдущего значения. Это не деталь
    реализации, а само правило: от предыдущего значения задачу двигают пять
    раз по одному дню, суммарно она уезжает на неделю, и ни одного объяснения
    в истории не остаётся.

    Сдвиг старта меряется календарными днями, а длительность — рабочими,
    потому что в рабочих она и задана. Смешение единиц осознанное: «перенесли
    на неделю» человек говорит про календарь, а «стало на два дня дольше» —
    про работу, и ни один из двух вопросов не становится понятнее, если
    ответить на него в чужих единицах.

    Измерения не смешиваются: названное измерение и меряется. Передан
    ``start_date`` — считается только сдвиг старта, передан ``duration_days``
    — только длительность. Иначе задача, чей срок уже объяснённо уехал за
    порог, требовала бы причину на каждую правку длительности в один день —
    и наоборот; заголовок X-Shift-Deviation-Days при этом называл бы число из
    чужого измерения. Без аргументов возвращается наибольшее из двух текущих
    отклонений — ответ на вопрос «насколько задача ушла от обещанного».
    """
    if task.baseline_start is None or task.baseline_duration is None:
        return None

    start_shift = abs(
        ((task.start_date if start_date is None else start_date) - task.baseline_start).days
    )
    duration_shift = abs(
        (task.duration_days if duration_days is None else duration_days)
        - task.baseline_duration
    )
    if start_date is not None and duration_days is None:
        return start_shift
    if duration_days is not None and start_date is None:
        return duration_shift
    return max(start_shift, duration_shift)


def approve_plan(db: DbSession, project: Project, *, actor_id: uuid.UUID | None) -> PlanVersion:
    """Утверждение (или переутверждение) плана.

    Снимок пишется сразу в двух местах: в ``PlanVersion.snapshot`` — как
    летопись, и в ``baseline_start`` / ``baseline_duration`` каждой задачи —
    как то, с чем сравнивается каждая последующая правка. Второе — не кэш
    первого: проверка порога случается на каждом перетаскивании, и разбирать
    ради неё JSON последней версии значило бы платить за одно и то же дважды.

    Строка проекта блокируется на всё время: номер версии считается как
    ``plan_version + 1``, и два одновременных утверждения без блокировки
    получили бы один номер — а его держит уникальное ограничение, то есть
    проигравший получил бы голую пятисотку.
    """
    db.execute(select(Project.id).where(Project.id == project.id).with_for_update())

    tasks = db.scalars(
        select(Task).where(Task.project_id == project.id).order_by(Task.position, Task.id)
    ).all()

    snapshot = {
        str(task.id): {
            # Название лежит в снимке рядом с датами, хотя спецификация
            # требует только дат: старая версия читается как обещание, а
            # обещание из голых идентификаторов не читается вовсе — тем более
            # что задачу с тех пор могли переименовать или удалить.
            "name": task.name,
            "start_date": task.start_date.isoformat(),
            "duration_days": task.duration_days,
        }
        for task in tasks
    }

    project.plan_version += 1
    project.plan_approved_at = datetime.now(timezone.utc)

    for task in tasks:
        task.baseline_start = task.start_date
        task.baseline_duration = task.duration_days

    version = PlanVersion(
        project_id=project.id,
        version=project.plan_version,
        approved_by=actor_id,
        snapshot=snapshot,
    )
    db.add(version)
    db.flush()
    return version


class PlanVersionNotFound(Exception):
    """Названной версии у проекта нет."""


def restore_plan_version(
    db: DbSession, project: Project, version: int, *, actor_id: uuid.UUID | None
) -> PlanVersion:
    """Возвращает базовый план к обещаниям версии `version`.

    Утверждение перестаёт быть необратимым: нажатый по ошибке «Утвердить»
    переписывал baseline у всех задач, и вернуть прежнее обещание было нечем —
    снимок лежал в летописи мёртвым грузом. Восстановление трогает только
    baseline_*: текущие даты задач — реальность, а не обещание, и откат
    обещания не должен двигать реальность.

    Результат — новая версия с тем же снимком, а не подмена текущей: летопись
    осталась летописью, и в ней видно, что обещание вернули к версии N.

    Задачи, созданные после версии N, в снимке отсутствуют — их baseline
    очищается: относительно возвращённого обещания они «сверх плана».
    """
    db.execute(select(Project.id).where(Project.id == project.id).with_for_update())

    source = db.scalar(
        select(PlanVersion).where(
            PlanVersion.project_id == project.id, PlanVersion.version == version
        )
    )
    if source is None:
        raise PlanVersionNotFound(str(version))

    tasks = db.scalars(select(Task).where(Task.project_id == project.id)).all()
    for task in tasks:
        promised = source.snapshot.get(str(task.id))
        if promised is None:
            task.baseline_start = None
            task.baseline_duration = None
        else:
            task.baseline_start = date.fromisoformat(promised["start_date"])
            task.baseline_duration = promised["duration_days"]

    project.plan_version += 1
    project.plan_approved_at = datetime.now(timezone.utc)
    restored = PlanVersion(
        project_id=project.id,
        version=project.plan_version,
        approved_by=actor_id,
        snapshot=source.snapshot,
    )
    db.add(restored)
    db.flush()
    return restored


def plan_versions(db: DbSession, project: Project) -> list[PlanVersion]:
    """Все версии плана, новые сверху."""
    return list(
        db.scalars(
            select(PlanVersion)
            .where(PlanVersion.project_id == project.id)
            .order_by(PlanVersion.version.desc())
        ).all()
    )
