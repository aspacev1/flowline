import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.models import Comment, Project, Task, User

# Тот же потолок, что и у остальных длинных текстов приложения. Отдельной
# настройки для комментария не заводится: два потолка на одно и то же
# однажды разъедутся, и человек узнает об этом на длинной реплике.
MAX_COMMENT_LEN = get_settings().max_text_len


class CommentRefused(Exception):
    """Отказ записать реплику.

    Несёт машинный код для ответа и человеческий текст — для журнала. Той же
    формы, что и MutationError: сервер словарей сообщений не держит, и проза
    в `detail` была бы непереводима.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class TaskNotInProject(CommentRefused):
    """Задача не существует или принадлежит другому проекту.

    Отдельный класс, потому что маршрут отвечает на это 404, а на остальные
    отказы — 422: обращение к чужой строке не ошибка формата запроса.
    """


def add_comment(
    db: DbSession,
    project: Project,
    *,
    body: str,
    task_id: uuid.UUID | None = None,
    author: User | None = None,
    guest_name: str | None = None,
) -> Comment:
    """Реплика в обсуждение проекта или одной его задачи.

    Автор — участник или гость по имени, ровно один из двух: то же правило,
    что держит CHECK в таблице. Проверяется и здесь, чтобы отказ был кодом
    ответа, а не IntegrityError пятисоткой.
    """
    if (author is None) == (guest_name is None):
        raise CommentRefused("comment_author_required", "реплику нечем подписать")

    # Хвостовые пробелы и перевод строки от textarea — не текст. Обрезаются
    # до проверки на пустоту, иначе «   » проходит как реплика.
    text = body.strip()
    if not text:
        raise CommentRefused("comment_empty", "пустая реплика")

    if task_id is not None:
        task = db.get(Task, task_id)
        if task is None or task.project_id != project.id:
            raise TaskNotInProject("task_not_found", "задача не найдена в этом проекте")

    comment = Comment(
        project_id=project.id,
        task_id=task_id,
        author_user_id=author.id if author else None,
        guest_name=guest_name,
        body=text,
    )
    db.add(comment)
    db.flush()
    return comment


def list_comments(
    db: DbSession,
    project: Project,
    *,
    task_id: uuid.UUID | None = None,
    limit: int = 200,
) -> list[Comment]:
    """Ветка обсуждения: одной задачи или проекта целиком.

    От старых к новым — разговор читают сверху вниз. Журнал ревизий рядом
    отсортирован наоборот, и это не рассогласование: там читают последнее
    событие, здесь — нить с начала.

    `is_(None)`, а не `== None`: сравнение с NULL в SQL истинным не бывает, и
    ветка проекта молча оказалась бы пустой.
    """
    query = select(Comment).where(Comment.project_id == project.id)
    query = query.where(
        Comment.task_id == task_id if task_id is not None else Comment.task_id.is_(None)
    )
    # id вторым ключом: две реплики одной миллисекунды по времени
    # неразличимы, и порядок между ними иначе решает планировщик.
    return list(db.scalars(query.order_by(Comment.created_at, Comment.id).limit(limit)).all())
