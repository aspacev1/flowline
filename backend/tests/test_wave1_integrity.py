"""Регрессионные тесты волны 1 плана исправлений: целостность данных.

Каждый тест воспроизводит путь, который до исправления вёл в 500 или в
необратимую потерю данных: двойная отмена из двух вкладок, отмена удаления,
теряющая связи и разговор, откат пачки в удалённую категорию, журнал
реордера размером со весь проект.
"""

import threading
import uuid
from datetime import date, datetime, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.models import (
    Category,
    Comment,
    Dependency,
    Membership,
    Organization,
    Project,
    Revision,
    Task,
    TaskAssignee,
    User,
)
from app.mutations import (
    ApplyPositions,
    CreateCategory,
    CreateTask,
    DeleteCategory,
    DeleteTask,
    InvalidOperation,
    MoveTask,
    MutationError,
    NotFoundInProject,
    PublicCreateTask,
    PublicMoveTask,
    ReasonRequired,
    ReorderTask,
    apply_op,
    undo,
    undo_batch,
    undo_last,
)


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
def category(db, project):
    revision = apply_op(db, project, CreateCategory(name="Design", color="#3b82f6"), actor_id=None)
    return db.get(Category, revision.op["category_id"])


def _task(db, project, category, *, name="Logo", start=date(2026, 3, 2), duration=5) -> Task:
    revision = apply_op(
        db,
        project,
        CreateTask(category_id=category.id, name=name, start_date=start, duration_days=duration),
        actor_id=None,
    )
    return db.get(Task, revision.op["task_id"])


# --- 1.1: гонка двойной отмены ----------------------------------------------


def test_two_simultaneous_undos_do_not_double_undo(engine):
    """Вторая из двух одновременных отмен ждёт замок и находит пустой журнал.

    До исправления обе вкладки выбирали одну и ту же ревизию до замка, и
    проигравшая применяла отмену второй раз — проект возвращался туда, откуда
    первая только что ушла. Тест держит замок незакоммиченной первой отменой
    и убеждается, что вторая блокируется, а дождавшись — получает
    nothing_to_undo, а не двойной откат.

    Работает на собственных сессиях с настоящими коммитами: замок строки
    виден только между разными транзакциями. Слаг уникален в базе, поэтому
    свой, а уборка — в finally, чтобы не оставить мусор соседям.
    """
    make_session = sessionmaker(bind=engine)
    marker = uuid.uuid4().hex[:8]
    setup = make_session()
    org = Organization(name="Race", slug=f"race-{marker}")
    setup.add(org)
    setup.flush()
    project = Project(org_id=org.id, name="Race", slug=f"race-{marker}")
    setup.add(project)
    setup.flush()
    org_id, project_id = org.id, project.id
    setup.commit()

    first = make_session()
    second = make_session()
    try:
        project_one = first.get(Project, project_id)
        category_rev = apply_op(
            first, project_one, CreateCategory(name="Design", color="#3b82f6"), actor_id=None
        )
        task_rev = apply_op(
            first,
            project_one,
            CreateTask(
                category_id=uuid.UUID(category_rev.op["category_id"]),
                name="Logo",
                start_date=date(2026, 3, 2),
                duration_days=5,
            ),
            actor_id=None,
        )
        task_id = uuid.UUID(task_rev.op["task_id"])
        apply_op(
            first,
            project_one,
            MoveTask(task_id=task_id, start_date=date(2026, 3, 9)),
            actor_id=None,
        )
        first.commit()

        # Первая отмена: замок взят, транзакция открыта — как будто запрос
        # ещё выполняется.
        applied, undone = undo_last(first, project_one, actor_id=None)
        assert undone.op["type"] == "move_task"

        outcome: dict[str, object] = {}

        def concurrent_undo():
            project_two = second.get(Project, project_id)
            try:
                _, rival_undone = undo_last(second, project_two, actor_id=None)
                outcome["undone_seq"] = rival_undone.seq
            except MutationError as error:
                outcome["refused"] = error.code
            finally:
                second.commit()

        rival = threading.Thread(target=concurrent_undo)
        rival.start()
        # Соперник обязан стоять на замке, пока первая транзакция не закрыта.
        rival.join(timeout=0.5)
        assert rival.is_alive(), "вторая отмена не ждала замок проекта"

        first.commit()
        rival.join(timeout=10)
        assert not rival.is_alive()

        # Два нажатия — два шага назад: соперник вправе отменить предыдущую
        # ревизию (создание задачи), но не ту же самую ещё раз.
        assert outcome.get("undone_seq") != undone.seq

        check = make_session()
        try:
            undo_revisions = check.scalars(
                select(Revision).where(
                    Revision.project_id == project_id, Revision.undoes_seq.is_not(None)
                )
            ).all()
            # Ключевая проверка: ход отменён ровно один раз.
            assert [r.undoes_seq for r in undo_revisions].count(undone.seq) == 1
            task = check.get(Task, task_id)
            # Задача либо на исходном месте (второй жест шагнул дальше — к
            # отмене создания), либо существует на исходной дате.
            if task is not None:
                assert task.start_date == date(2026, 3, 2)
        finally:
            check.close()
    finally:
        first.rollback()
        first.close()
        second.close()
        cleanup = make_session()
        cleanup.delete(cleanup.get(Organization, org_id))
        cleanup.commit()
        cleanup.close()


def test_undo_with_an_empty_journal_refuses_with_a_code(db, project):
    with pytest.raises(NotFoundInProject) as error:
        undo_last(db, project, actor_id=None)
    assert error.value.code == "nothing_to_undo"


# --- 1.2: край дат ------------------------------------------------------------


def test_wire_dates_beyond_the_horizon_are_refused():
    """Дата за горизонтом отклоняется на проводе, а не падает в календаре."""
    with pytest.raises(ValidationError):
        PublicMoveTask(task_id=uuid.uuid4(), start_date=date(2201, 1, 1))
    with pytest.raises(ValidationError):
        PublicCreateTask(
            category_id=uuid.uuid4(),
            name="Далеко",
            start_date=date(2201, 1, 1),
            duration_days=1,
        )
    with pytest.raises(ValidationError):
        PublicCreateTask(
            category_id=uuid.uuid4(),
            name="Далеко",
            start_date=date(2026, 1, 1),
            duration_days=1,
            baseline_start=date(2201, 1, 1),
        )


# --- 1.4: отмена удаления возвращает окружение задачи ------------------------


def _member(db, org_id, *, name="Мария", email="m@example.com") -> User:
    user = User(name=name, email=email, password_hash="x")
    db.add(user)
    db.flush()
    db.add(Membership(org_id=org_id, user_id=user.id, role="editor"))
    db.flush()
    return user


def test_undoing_a_task_deletion_restores_links_assignees_and_comments(db, project, category):
    task = _task(db, project, category)
    other = _task(db, project, category, name="Сайт")
    user = _member(db, project.org_id)

    db.add(Dependency(project_id=project.id, from_task_id=task.id, to_task_id=other.id))
    db.add(TaskAssignee(task_id=task.id, user_id=user.id))
    comment_id = uuid.uuid4()
    created_at = datetime(2026, 3, 3, 12, 0, tzinfo=timezone.utc)
    db.add(
        Comment(
            id=comment_id,
            project_id=project.id,
            task_id=task.id,
            author_user_id=user.id,
            body="Согласовано с клиентом",
            created_at=created_at,
        )
    )
    db.flush()

    deletion = apply_op(db, project, DeleteTask(task_id=task.id), actor_id=None)
    # Каскад унёс окружение — ровно то, что до исправления пропадало навсегда.
    assert db.get(Comment, comment_id) is None

    undo(db, project, deletion, actor_id=None)

    restored = db.get(Task, task.id)
    assert restored is not None
    assert db.scalar(
        select(Dependency).where(
            Dependency.from_task_id == task.id, Dependency.to_task_id == other.id
        )
    ) is not None
    assert db.scalar(
        select(TaskAssignee).where(
            TaskAssignee.task_id == task.id, TaskAssignee.user_id == user.id
        )
    ) is not None
    comment = db.get(Comment, comment_id)
    assert comment is not None
    assert comment.body == "Согласовано с клиентом"
    assert comment.created_at == created_at
    assert comment.author_user_id == user.id


def test_restoring_a_task_skips_links_whose_other_end_is_gone(db, project, category):
    """Мир ушёл вперёд: второй конец связи удалён — отмена не падает.

    Пропуск, а не отказ: каскад сделал бы со связью то же самое, а отказ
    оставил бы человека вовсе без задачи.
    """
    task = _task(db, project, category)
    other = _task(db, project, category, name="Сайт")
    db.add(Dependency(project_id=project.id, from_task_id=task.id, to_task_id=other.id))
    db.flush()

    deletion = apply_op(db, project, DeleteTask(task_id=task.id), actor_id=None)
    apply_op(db, project, DeleteTask(task_id=other.id), actor_id=None)

    undo(db, project, deletion, actor_id=None)

    assert db.get(Task, task.id) is not None
    assert (
        db.scalar(select(Dependency).where(Dependency.from_task_id == task.id)) is None
    )


def test_a_guest_comment_survives_the_delete_undo_cycle(db, project, category):
    task = _task(db, project, category)
    db.add(
        Comment(
            project_id=project.id,
            task_id=task.id,
            guest_name="Заказчик",
            body="Хочется зеленее",
            created_at=datetime(2026, 3, 4, 9, 30, tzinfo=timezone.utc),
        )
    )
    db.flush()

    deletion = apply_op(db, project, DeleteTask(task_id=task.id), actor_id=None)
    undo(db, project, deletion, actor_id=None)

    comment = db.scalar(select(Comment).where(Comment.task_id == task.id))
    assert comment is not None
    assert comment.guest_name == "Заказчик"
    assert comment.author_user_id is None


# --- 1.5: откат пачки ---------------------------------------------------------


def test_batch_undo_into_a_deleted_category_refuses_with_a_code(db, project, category):
    """Восстановление в удалённую категорию — отказ с кодом, а не FK-пятисотка."""
    batch_id = uuid.uuid4()
    task_rev = apply_op(
        db,
        project,
        CreateTask(
            category_id=category.id, name="Логотип", start_date=date(2026, 3, 2), duration_days=5
        ),
        actor_id=None,
        batch_id=batch_id,
    )
    task_id = uuid.UUID(task_rev.op["task_id"])
    delete_batch = uuid.uuid4()
    apply_op(db, project, DeleteTask(task_id=task_id), actor_id=None, batch_id=delete_batch)
    apply_op(db, project, DeleteCategory(category_id=category.id), actor_id=None)

    with pytest.raises(NotFoundInProject) as error:
        undo_batch(db, project, delete_batch, actor_id=None)
    assert error.value.code == "category_not_found"


def test_apply_positions_with_desynced_maps_refuses_with_a_code(db, project, category):
    task = _task(db, project, category)
    with pytest.raises(InvalidOperation) as error:
        apply_op(
            db,
            project,
            ApplyPositions(positions={task.id: 0}, categories={}),
            actor_id=None,
        )
    assert error.value.code == "positions_categories_mismatch"


def test_batch_undo_accepts_a_reason_and_passes_the_threshold(db, project, category):
    """Откат, уводящий задачу от базового плана, объясним — и потому возможен.

    До исправления undo_batch причину не принимал вовсе: пачка, вернувшая
    задачу к плану, была неоткатываемой — обратный ход требовал причину,
    а передать её было некуда.
    """
    from app.plans import approve_plan

    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)

    apply_op(
        db,
        project,
        MoveTask(task_id=task.id, start_date=date(2026, 3, 16)),
        actor_id=None,
        reason="подрядчик сорвал срок",
    )
    return_batch = uuid.uuid4()
    apply_op(
        db,
        project,
        MoveTask(task_id=task.id, start_date=date(2026, 3, 2)),
        actor_id=None,
        batch_id=return_batch,
    )

    # Откат возврата уводит от плана на 14 дней — без причины отказ...
    with pytest.raises(ReasonRequired):
        undo_batch(db, project, return_batch, actor_id=None)

    # ...а с причиной тот же откат проходит.
    undo_batch(db, project, return_batch, actor_id=None, reason="возврат был ошибкой")
    assert task.start_date == date(2026, 3, 16)


# --- 1.6: журнал реордера — дифф, а не снимок проекта -------------------------


def test_reorder_journals_only_the_rows_that_moved(db, project, category):
    first = _task(db, project, category, name="Первая")
    second = _task(db, project, category, name="Вторая")
    third = _task(db, project, category, name="Третья")
    other_rev = apply_op(db, project, CreateCategory(name="Разработка", color="#111111"),
                         actor_id=None)
    bystander = _task(
        db, project, db.get(Category, other_rev.op["category_id"]), name="Сторонняя"
    )

    revision = apply_op(
        db,
        project,
        ReorderTask(task_id=second.id, category_id=category.id, position=0),
        actor_id=None,
    )

    touched = set(revision.op["to"])
    # Задача чужой категории не двигалась — в журнале её быть не должно.
    assert str(bystander.id) not in touched
    # Третья задача осталась на своей позиции — тоже вне журнала.
    assert str(third.id) not in touched
    assert touched == {str(first.id), str(second.id)}
    assert set(revision.inverse["positions"]) == touched

    # Дифф достаточен для отмены: порядок возвращается в точности.
    undo(db, project, revision, actor_id=None)
    assert [db.get(Task, t.id).position for t in (first, second, third)] == [0, 1, 2]


def test_reorder_to_the_same_place_journals_nothing(db, project, category):
    task = _task(db, project, category)
    revision = apply_op(
        db,
        project,
        ReorderTask(task_id=task.id, category_id=category.id, position=0),
        actor_id=None,
    )
    assert revision.op["to"] == {}
    assert revision.inverse["positions"] == {}
