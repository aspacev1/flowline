from datetime import date

import pytest

from app.comments import CommentRejected, add_comment, list_comments
from app.models import Category, Organization, Project, Task, User
from app.security import hash_password


@pytest.fixture
def project(db):
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    project = Project(org_id=org.id, name="Redesign", slug="redesign")
    db.add(project)
    db.flush()
    return project


@pytest.fixture
def author(db):
    user = User(email="a@b.c", password_hash=hash_password("s3cret-pass"), name="Alex")
    db.add(user)
    db.flush()
    return user


def _task(db, project) -> Task:
    category = Category(project_id=project.id, name="Design", color="#3b82f6", position=0)
    db.add(category)
    db.flush()
    task = Task(
        project_id=project.id,
        category_id=category.id,
        name="Логотип",
        start_date=date(2026, 3, 4),
        duration_days=5,
    )
    db.add(task)
    db.flush()
    return task


def test_reply_keeps_the_text_as_it_was_written(db, project, author):
    """Тело — содержимое пользователя: ни перевода, ни переформатирования."""
    comment = add_comment(db, project, body="  Согласовано с клиентом  ", author=author)

    assert comment.body == "Согласовано с клиентом"
    assert comment.author_user_id == author.id
    assert comment.guest_name is None
    assert comment.task_id is None


def test_empty_reply_is_refused(db, project, author):
    """Пробелы — не реплика. Иначе в ленте появляются пустые строки, которые
    нельзя ни прочитать, ни удалить."""
    with pytest.raises(CommentRejected) as refusal:
        add_comment(db, project, body="   \n  ", author=author)

    assert refusal.value.code == "comment_empty"


def test_reply_to_a_task_of_another_project_is_refused(db, project, author):
    """Задача чужого проекта — не задача этого. Без проверки реплика уезжает
    в чужую ленту, и увидит её тот, кому чужой проект не показывают."""
    other = Project(org_id=project.org_id, name="Other", slug="other")
    db.add(other)
    db.flush()
    stranger = _task(db, other)

    with pytest.raises(CommentRejected) as refusal:
        add_comment(db, project, body="сюда", task_id=stranger.id, author=author)

    assert refusal.value.code == "task_not_found"


def test_thread_reads_from_older_to_newer(db, project, author):
    """Разговор читают сверху вниз, в отличие от журнала ревизий."""
    for text in ("первое", "второе", "третье"):
        add_comment(db, project, body=text, author=author)

    assert [c.body for c in list_comments(db, project)] == ["первое", "второе", "третье"]


def test_the_task_thread_shows_only_its_own_replies(db, project, author):
    """Карточка задачи показывает разговор о ней, а не всё подряд.

    В обратную сторону отбора нет: лента проекта — это весь его разговор,
    включая реплики к строкам. Прятать их от неё значило бы завести второе
    место, куда надо заглянуть, чтобы не пропустить сказанное.
    """
    task = _task(db, project)
    add_comment(db, project, body="о проекте", author=author)
    add_comment(db, project, body="о задаче", task_id=task.id, author=author)

    assert [c.body for c in list_comments(db, project)] == ["о проекте", "о задаче"]
    assert [c.body for c in list_comments(db, project, task_id=task.id)] == ["о задаче"]


def test_guest_signs_with_a_name(db, project):
    """Гость по ссылке подписан именем, а не аккаунтом. Маршрута к нему ещё
    нет, но домен обязан уметь его записать — иначе публичные ссылки начнут
    с переписывания этого модуля."""
    comment = add_comment(db, project, body="а когда сдача?", guest_name="Мария")

    assert comment.guest_name == "Мария"
    assert comment.author_user_id is None


def test_reply_without_any_author_is_refused(db, project):
    """Ни аккаунта, ни имени — подписать реплику нечем. Это ошибка вызывающего,
    а не входных данных: маршрут либо знает участника, либо получил имя гостя,
    и третьего случая у него нет."""
    with pytest.raises(ValueError):
        add_comment(db, project, body="аноним")


def test_reply_signed_twice_is_refused_as_well(db, project, author):
    """Участник, притворившийся гостем, — тот же самый недосмотр с другой
    стороны, и ограничение в базе его тоже не пропустит."""
    with pytest.raises(ValueError):
        add_comment(db, project, body="и так и так", author=author, guest_name="Мария")
