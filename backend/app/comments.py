"""Комментарии к проекту и к отдельной задаче.

Комментарий не мутация: он ничего не меняет в плане, не имеет обратной
операции и в журнал ревизий не попадает. Поэтому он живёт своим модулем, а не
очередной веткой в реестре операций, где обязателен `inverse`.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.models import Comment, Project, Task, User

# Имя гостя — подпись под репликой, а не текст: длинное имя ломает вёрстку
# ленты, а не несёт смысла. Совпадает с длиной колонки.
MAX_GUEST_NAME_LEN = 80


class CommentRejected(Exception):
    """Отказ принять комментарий.

    Как и у мутаций, наружу выходит машинный код, а не проза: словарей
    сообщений сервер не держит, их составляет клиент.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _clean_body(raw: str) -> str:
    body = raw.strip()
    if not body:
        raise CommentRejected("comment_empty", "пустой комментарий")
    if len(body) > get_settings().max_text_len:
        raise CommentRejected("comment_too_long", "комментарий длиннее допустимого")
    return body


def _clean_guest_name(raw: str) -> str:
    name = raw.strip()
    if not name:
        raise CommentRejected("guest_name_required", "гость не назвал имени")
    return name[:MAX_GUEST_NAME_LEN]


def _resolve_task(db: DbSession, project: Project, task_id: uuid.UUID | None) -> uuid.UUID | None:
    if task_id is None:
        return None
    task = db.get(Task, task_id)
    # Задача чужого проекта неотличима от несуществующей — тем же принципом,
    # что и в маршрутах: иначе комментарий становится способом проверять,
    # существует ли задача в чужой организации.
    if task is None or task.project_id != project.id:
        raise CommentRejected("task_not_found", "задача не найдена в этом проекте")
    return task.id


def add_comment(
    db: DbSession,
    project: Project,
    *,
    body: str,
    task_id: uuid.UUID | None = None,
    author: User | None = None,
    guest_name: str | None = None,
    internal: bool = False,
) -> Comment:
    """Добавляет реплику от участника или от гостя.

    Ровно один автор: участник подписан аккаунтом, гость — именем, которое он
    ввёл. Оба сразу или ни одного — ошибка вызывающего, а не входных данных,
    поэтому здесь она поднимается как ValueError, а не как отказ с кодом.

    Внутренняя реплика гостю недоступна в обе стороны: он её не видит и не
    может написать. Гость с internal — ошибка вызывающего кода: публичный
    маршрут признака не принимает вовсе.
    """
    if (author is None) == (guest_name is None):
        raise ValueError("у комментария должен быть ровно один автор: участник или гость")
    if internal and author is None:
        raise ValueError("внутренняя реплика не может быть гостевой")

    comment = Comment(
        project_id=project.id,
        task_id=_resolve_task(db, project, task_id),
        author_user_id=author.id if author is not None else None,
        guest_name=_clean_guest_name(guest_name) if guest_name is not None else None,
        body=_clean_body(body),
        internal=internal,
    )
    db.add(comment)
    db.flush()
    return comment


def list_comments(
    db: DbSession,
    project: Project,
    *,
    task_id: uuid.UUID | None = None,
    include_internal: bool = True,
) -> Sequence[Comment]:
    """Лента проекта, при желании — одной задачи.

    Старые сверху: разговор читается сверху вниз, в отличие от журнала
    ревизий, где нужна последняя запись.

    include_internal=False — лента глазами гостя публичной ссылки: реплики
    «в сторону» в неё не попадают. Фильтр здесь, а не в маршруте: маршрутов,
    отдающих ленту, два, и расходиться им нельзя.
    """
    query = select(Comment).where(Comment.project_id == project.id)
    if task_id is not None:
        query = query.where(Comment.task_id == task_id)
    if not include_internal:
        query = query.where(Comment.internal.is_(False))
    return db.scalars(query.order_by(Comment.created_at, Comment.id)).all()


def author_names(db: DbSession, comments: Sequence[Comment]) -> dict[uuid.UUID, str]:
    """Имена авторов одним запросом, а не по запросу на реплику."""
    ids = {c.author_user_id for c in comments if c.author_user_id is not None}
    if not ids:
        return {}
    return {
        user.id: user.name for user in db.scalars(select(User).where(User.id.in_(ids))).all()
    }
