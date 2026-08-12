"""Утверждённый план и обязательная причина сдвига — раздел 5 спецификации.

Пункт 2 раздела 13 требует отдельно проверить накопление: три сдвига по
одному дню от базового плана требуют причину на третьем. Это и есть смысл
правила «отклонение считается от базового плана, а не от предыдущего
значения», и без такого теста подмена базы на предыдущее значение прошла бы
незамеченной — каждый отдельный сдвиг на один день выглядит невинно.
"""

from datetime import date

import pytest

from app.models import Category, Organization, Project, Task
from app.mutations import (
    CreateCategory,
    CreateTask,
    MoveTask,
    ReasonRequired,
    SetDuration,
    apply_op,
    undo,
)
from app.plans import approve_plan, deviation_days, plan_versions


@pytest.fixture
def org(db):
    org = Organization(name="Acme", slug="acme")
    db.add(org)
    db.flush()
    return org


@pytest.fixture
def project(db, org):
    project = Project(org_id=org.id, name="Redesign", slug="redesign")
    db.add(project)
    db.flush()
    return project


@pytest.fixture
def category(db, project):
    revision = apply_op(db, project, CreateCategory(name="Design", color="#3b82f6"), actor_id=None)
    return db.get(Category, revision.op["category_id"])


def _task(db, project, category, *, start=date(2026, 3, 2), duration=5, name="Logo") -> Task:
    revision = apply_op(
        db,
        project,
        CreateTask(
            category_id=str(category.id), name=name, start_date=start, duration_days=duration
        ),
        actor_id=None,
    )
    return db.get(Task, revision.op["task_id"])


# --- утверждение -------------------------------------------------------------


def test_approval_snapshots_dates_into_the_baseline_of_every_task(db, project, category):
    task = _task(db, project, category)

    version = approve_plan(db, project, actor_id=None)

    assert version.version == 1
    assert project.plan_version == 1
    assert project.plan_approved_at is not None
    assert task.baseline_start == date(2026, 3, 2)
    assert task.baseline_duration == 5
    assert version.snapshot[str(task.id)] == {
        "name": "Logo",
        "start_date": "2026-03-02",
        "duration_days": 5,
    }


def test_a_task_created_after_approval_has_no_baseline(db, project, category):
    _task(db, project, category)
    approve_plan(db, project, actor_id=None)

    extra = _task(db, project, category, name="Сверх плана")

    # Ровно это и означает пометка «сверх первоначального плана»: добавление
    # работы нормально, объяснений оно не требует.
    assert extra.baseline_start is None
    assert extra.baseline_duration is None
    assert deviation_days(extra, start_date=date(2026, 12, 1)) is None


def test_reapproval_moves_the_baseline_and_keeps_the_old_version(db, project, category):
    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)

    apply_op(db, project, MoveTask(task_id=task.id, start_date=date(2026, 3, 30)), actor_id=None,
             reason="заказчик не прислал брендбук")
    second = approve_plan(db, project, actor_id=None)

    assert second.version == 2
    assert task.baseline_start == date(2026, 3, 30)

    # Старая версия остаётся: летопись «что обещали в январе» иначе исчезает
    # ровно в тот момент, когда обещание перестало выполняться.
    versions = plan_versions(db, project)
    assert [v.version for v in versions] == [2, 1]
    assert versions[-1].snapshot[str(task.id)]["start_date"] == "2026-03-02"


# --- порог -------------------------------------------------------------------


def test_a_shift_within_the_threshold_needs_no_reason(db, project, category, org):
    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)

    apply_op(db, project, MoveTask(task_id=task.id, start_date=date(2026, 3, 4)), actor_id=None)

    assert task.start_date == date(2026, 3, 4)


def test_a_shift_beyond_the_threshold_without_a_reason_is_refused(db, project, category, org):
    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)

    with pytest.raises(ReasonRequired) as error:
        apply_op(db, project, MoveTask(task_id=task.id, start_date=date(2026, 3, 9)), actor_id=None)

    assert error.value.code == "reason_required"
    assert error.value.deviation_days == 7
    assert error.value.threshold_days == org.default_shift_threshold_days
    # Промежуточного состояния «сдвинуто, но не объяснено» не существует:
    # изменение не применилось вовсе.
    assert task.start_date == date(2026, 3, 2)


def test_the_same_shift_goes_through_once_the_reason_is_given(db, project, category):
    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)

    revision = apply_op(
        db,
        project,
        MoveTask(task_id=task.id, start_date=date(2026, 3, 9)),
        actor_id=None,
        reason="заказчик не прислал брендбук",
    )

    assert task.start_date == date(2026, 3, 9)
    # Причина хранится как введено и не переводится: это текст человека.
    assert revision.reason == "заказчик не прислал брендбук"


def test_three_one_day_shifts_ask_for_a_reason_on_the_third(db, project, category):
    """Накопление — пункт 2 раздела 13.

    Порог 2 дня. Каждый отдельный шаг — один день, то есть меньше порога при
    счёте от предыдущего значения; от базового плана третий шаг даёт 3 дня и
    обязан спросить причину.
    """
    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)

    apply_op(db, project, MoveTask(task_id=task.id, start_date=date(2026, 3, 3)), actor_id=None)
    apply_op(db, project, MoveTask(task_id=task.id, start_date=date(2026, 3, 4)), actor_id=None)

    with pytest.raises(ReasonRequired) as error:
        apply_op(db, project, MoveTask(task_id=task.id, start_date=date(2026, 3, 5)), actor_id=None)

    assert error.value.deviation_days == 3
    assert task.start_date == date(2026, 3, 4)


def test_a_shift_back_towards_the_baseline_needs_no_reason(db, project, category):
    """Отклонение считается по модулю, но от базового плана.

    Задача, уехавшая на неделю с объяснением, возвращается на место свободно:
    объяснять надо расхождение с обещанным, а не всякое движение.
    """
    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)
    apply_op(
        db,
        project,
        MoveTask(task_id=task.id, start_date=date(2026, 3, 16)),
        actor_id=None,
        reason="подрядчик сорвал срок",
    )

    apply_op(db, project, MoveTask(task_id=task.id, start_date=date(2026, 3, 2)), actor_id=None)

    assert task.start_date == date(2026, 3, 2)


def test_stretching_the_duration_past_the_threshold_also_asks(db, project, category):
    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)

    with pytest.raises(ReasonRequired) as error:
        apply_op(db, project, SetDuration(task_id=task.id, duration_days=9), actor_id=None)

    assert error.value.deviation_days == 4
    assert task.duration_days == 5


def test_before_approval_nothing_is_asked(db, project, category):
    """До нажатия «Утвердить план» правки свободны, ничего не спрашивается."""
    task = _task(db, project, category)

    apply_op(db, project, MoveTask(task_id=task.id, start_date=date(2026, 6, 1)), actor_id=None)

    assert task.start_date == date(2026, 6, 1)


def test_the_project_threshold_overrides_the_organization_one(db, project, category, org):
    org.default_shift_threshold_days = 2
    project.shift_threshold_days = 10
    db.flush()
    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)

    apply_op(db, project, MoveTask(task_id=task.id, start_date=date(2026, 3, 10)), actor_id=None)

    assert task.start_date == date(2026, 3, 10)


def test_undo_of_a_shift_beyond_the_threshold_asks_as_well(db, project, category):
    """Отмена — не привилегированное действие.

    Если возврат уводит задачу от базового плана дальше порога, объяснение
    нужно ровно так же, как при любом другом способе туда попасть; иначе
    правило обходится парой «сдвинуть с причиной — отменить отмену».
    """
    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)
    shift = apply_op(
        db,
        project,
        MoveTask(task_id=task.id, start_date=date(2026, 3, 16)),
        actor_id=None,
        reason="подрядчик сорвал срок",
    )
    back = undo(db, project, shift, actor_id=None)

    with pytest.raises(ReasonRequired):
        undo(db, project, back, actor_id=None)

    assert task.start_date == date(2026, 3, 2)


def test_a_duration_edit_is_not_charged_for_the_start_shift(db, project, category):
    """Волна 1.7: измерения не смешиваются.

    Задача с объяснённо уехавшим стартом (7 дней при пороге 2) правит
    длительность на день — в пределах порога. До исправления отклонение
    считалось как max по обоим измерениям, и правка длительности требовала
    причину за чужой сдвиг старта.
    """
    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)
    apply_op(
        db,
        project,
        MoveTask(task_id=task.id, start_date=date(2026, 3, 9)),
        actor_id=None,
        reason="подрядчик сорвал срок",
    )

    apply_op(db, project, SetDuration(task_id=task.id, duration_days=6), actor_id=None)

    assert task.duration_days == 6


def test_the_reported_deviation_belongs_to_the_edited_dimension(db, project, category):
    """Заголовок X-Shift-Deviation-Days называет число из правимого измерения.

    Старт уехал на 7, правится длительность на 4: отказ обязан назвать 4 —
    интерфейс показывает это число человеку как «на сколько уводит ваша
    правка», и 7 в нём было бы ложью.
    """
    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)
    apply_op(
        db,
        project,
        MoveTask(task_id=task.id, start_date=date(2026, 3, 9)),
        actor_id=None,
        reason="подрядчик сорвал срок",
    )

    with pytest.raises(ReasonRequired) as error:
        apply_op(db, project, SetDuration(task_id=task.id, duration_days=9), actor_id=None)

    assert error.value.deviation_days == 4


def test_without_arguments_deviation_reports_the_larger_dimension(db, project, category):
    task = _task(db, project, category)
    approve_plan(db, project, actor_id=None)
    apply_op(
        db,
        project,
        MoveTask(task_id=task.id, start_date=date(2026, 3, 9)),
        actor_id=None,
        reason="подрядчик сорвал срок",
    )

    # Вопрос «насколько задача ушла от обещанного» — по-прежнему max.
    assert deviation_days(task) == 7
