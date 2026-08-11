"""Состояние проекта и лента комментариев в том виде, в каком они уходят по проводу.

Вынесено из маршрута, потому что читателей у одного и того же состояния стало
двое: рабочий экран участника и публичная страница гостя. Разница между ними —
не другой набор полей, а два признака видимости, и держать её здесь дешевле,
чем поддерживать вторую сборку того же ответа, которая однажды разойдётся с
первой ровно на то поле, которое гостю видеть нельзя.
"""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.calendar import end_date
from app.comments import author_names
from app.models import Category, Comment, Dependency, Organization, Project, Task, TaskAssignee
from app.settings_resolution import project_calendar, resolve_shift_threshold, resolve_timezone


def project_state(
    db: DbSession,
    project: Project,
    org: Organization,
    *,
    show_notes: bool,
    show_people: bool = True,
) -> dict:
    """Проект целиком: календарь, категории, задачи, связи.

    `show_notes` — внутренняя заметка; её не видят ни `client`, ни гость.
    `show_people` — исполнители задач. Гостю они не отдаются даже
    идентификаторами: состав организации — не то, что публикуют вместе с
    планом, и по спецификации его не видит даже `client` с аккаунтом.

    Поднимает `CalendarError`, если рабочих дней в календаре не осталось:
    решение, каким кодом это назвать, принимает маршрут.
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
    assignees: dict[str, list[str]] = {str(t.id): [] for t in tasks}
    if show_people:
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

    ends = [end_date(t.start_date, t.duration_days, calendar) for t in tasks]

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
                "assignee_ids": assignees[str(t.id)],
                **({"internal_note": t.internal_note} if show_notes else {}),
            }
            for t, task_end in zip(tasks, ends)
        ],
        "dependencies": [
            {"from_task_id": str(source), "to_task_id": str(target)}
            for source, target in dependencies
        ],
    }


def comments_out(db: DbSession, comments: Sequence[Comment]) -> list[dict]:
    """Лента реплик.

    Автор отдаётся одинаково для участника и для гостя — именем и признаком
    `guest`. Идентификатор участника наружу не выходит: подписи под репликой
    он не нужен, а публичная страница показывает ту же ленту, что и рабочий
    экран.
    """
    names: dict[UUID, str] = author_names(db, comments)
    return [
        {
            "id": str(comment.id),
            "task_id": str(comment.task_id) if comment.task_id else None,
            "author": {
                "name": (
                    comment.guest_name
                    if comment.guest_name is not None
                    else names.get(comment.author_user_id, "")
                ),
                "guest": comment.guest_name is not None,
            },
            "body": comment.body,
            "created_at": comment.created_at.isoformat(),
        }
        for comment in comments
    ]
