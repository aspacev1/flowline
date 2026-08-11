from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.calendar import CalendarError, end_date
from app.models import Category, Dependency, Organization, Project, Task, TaskAssignee
from app.settings_resolution import project_calendar, resolve_shift_threshold, resolve_timezone


def build_state(
    db: DbSession,
    project: Project,
    org: Organization,
    *,
    show_notes: bool,
    show_assignees: bool,
) -> dict:
    """Состояние проекта в том виде, в каком его показывают на экране.

    Один сборщик на рабочий экран и на публичную страницу. Вторая копия
    разошлась бы с первой на первой же новой колонке — а если этой колонкой
    окажется внутренняя заметка, она утечёт наружу именно через ту копию, про
    которую забыли.

    Что показывать, решает вызывающий: заметку — по праву READ_INTERNAL_NOTE,
    исполнителей — по тому, видит ли читатель состав организации вообще.
    """
    calendar = project_calendar(project, org)

    # Позиции могут совпадать в одном крайнем случае (строка, восстановленная
    # отменой на позицию, которую с тех пор занял другой ряд), поэтому id —
    # обязательный второй ключ сортировки, а не только position.
    categories = db.scalars(
        select(Category)
        .where(Category.project_id == project.id)
        .order_by(Category.position, Category.id)
    ).all()
    tasks = db.scalars(
        select(Task).where(Task.project_id == project.id).order_by(Task.position, Task.id)
    ).all()

    # Один запрос на весь проект, а не по запросу на задачу: на сотне задач
    # второе дало бы сотню запросов ради одного экрана.
    assignees: dict[str, list[str]] = {}
    if show_assignees:
        assignees = {str(t.id): [] for t in tasks}
        for task_id, user_id in db.execute(
            select(TaskAssignee.task_id, TaskAssignee.user_id)
            .join(Task, Task.id == TaskAssignee.task_id)
            .where(Task.project_id == project.id)
            .order_by(TaskAssignee.user_id)
        ).all():
            assignees[str(task_id)].append(str(user_id))

    dependencies = db.execute(
        select(Dependency.from_task_id, Dependency.to_task_id)
        .where(Dependency.project_id == project.id)
        .order_by(Dependency.from_task_id, Dependency.to_task_id)
    ).all()

    try:
        ends = [end_date(t.start_date, t.duration_days, calendar) for t in tasks]
    except CalendarError as error:
        # Той же формы, что и отказы мутаций: 422 с машинным кодом. Раньше
        # здесь была голая пятисотка — вырожденную маску задаёт человек, и
        # проект переставал читаться без объяснения.
        raise HTTPException(status_code=422, detail=error.code)

    return {
        "id": str(project.id),
        "name": project.name,
        "slug": project.slug,
        "deadline": project.deadline.isoformat() if project.deadline else None,
        # Максимум по датам окончания задач; пустой проект не имеет конца.
        "project_end": max(ends).isoformat() if ends else None,
        # Календарь едет вместе с состоянием: интерфейс заливает нерабочие дни
        # и рисует выходные ещё до первого клика, а не догадывается о них.
        "calendar": {
            "working_days": calendar.working_days,
            "holidays": sorted(d.isoformat() for d in calendar.holidays),
            "extra_workdays": sorted(d.isoformat() for d in calendar.extra_workdays),
        },
        # Разрешённые значения, а не сырые nullable-колонки проекта: кто их
        # унаследовал от организации, а кто задал сам — не дело интерфейса.
        "settings": {
            "shift_threshold_days": resolve_shift_threshold(project, org),
            "timezone": resolve_timezone(project, org),
        },
        "categories": [
            {"id": str(c.id), "name": c.name, "color": c.color, "position": c.position}
            for c in categories
        ],
        "tasks": [
            {
                "id": str(t.id),
                "category_id": str(t.category_id),
                "name": t.name,
                "description": t.description,
                "start_date": t.start_date.isoformat(),
                "duration_days": t.duration_days,
                "end_date": task_end.isoformat(),
                "criticality": t.criticality,
                "progress_pct": t.progress_pct,
                "position": t.position,
                # Исполнители — это состав организации, а его гость не видит и
                # в остальных маршрутах: роль `client` не получает /org/members
                # вовсе. Ключ отсутствует, а не пуст, — иначе интерфейс не
                # отличит «некому показать» от «никто не назначен».
                **({"assignee_ids": assignees[str(t.id)]} if show_assignees else {}),
                **({"internal_note": t.internal_note} if show_notes else {}),
            }
            for t, task_end in zip(tasks, ends)
        ],
        "dependencies": [
            {"from_task_id": str(source), "to_task_id": str(target)}
            for source, target in dependencies
        ],
    }
