import type { PlanApproval, ProjectState, Task } from "../api/projects";
import { daysBetween } from "../gantt/timescale";
import { baselineOf, isBeyondPlan } from "./baseline";

/**
 * Чем текущий план отличается от согласованного.
 *
 * Сравниваются состояния, а не перечисляются действия: задача, уехавшая на три
 * дня и вернувшаяся обратно, изменением не является — журнал истории про неё
 * помнит, а план с ней сходится. Поэтому источник здесь тот же, что у бейджа
 * отклонения на полоске, — базовый план на самой задаче, а не лента ревизий.
 *
 * Ничего не запрашивается: базовые значения приходят вместе с состоянием
 * проекта, и весь список считается из того, что уже на экране.
 */

/** Одно расхождение с согласованным планом. */
export type PlanChange =
  | {
      kind: "shift";
      task: Task;
      /** Начало по согласованному плану и начало сейчас. */
      from: string;
      to: string;
      /** Знак сохранён: минус — задачу приблизили. */
      days: number;
      /** Длительность, если её меняли тем же движением. `null` — не меняли. */
      stretch: { from: number; to: number } | null;
    }
  | { kind: "duration"; task: Task; from: number; to: number; days: number }
  | { kind: "added"; task: Task }
  /**
   * Задача из снимка версии, которой больше нет.
   *
   * Своей задачи у неё не осталось — только имя из снимка: удалённое состояние
   * проекта не хранит, и по нему такое расхождение не вычислить вовсе.
   */
  | { kind: "removed"; taskId: string; name: string };

export type PlanChanges = {
  shifts: Extract<PlanChange, { kind: "shift" }>[];
  durations: Extract<PlanChange, { kind: "duration" }>[];
  added: Extract<PlanChange, { kind: "added" }>[];
  /**
   * Сколько задач разошлось с планом.
   *
   * Считаются задачи, а не расхождения: число, растущее от того, сколько раз
   * задачу трогали, говорило бы о суете, а не о плане.
   *
   * Поэтому группы делят задачи, а не пересекаются: задача, которую подвинули
   * и растянули одним движением, стоит в «сдвигах», а растяжение названо в её
   * же строке. Иначе сумма групп разошлась бы с этим числом, и человек,
   * складывающий подписи тегов, получал бы не то, что написано на чипе.
   *
   * Удалённые сюда не входят: их знает только снимок версии, а он грузится
   * отдельно и лишь при открытии окна (см. removedTasks).
   */
  taskCount: number;
};

/** Пусто — план сошёлся с согласованным либо согласовывать ещё нечего. */
const NOTHING: PlanChanges = { shifts: [], durations: [], added: [], taskCount: 0 };

export function planChanges(state: ProjectState): PlanChanges {
  if (!state.plan_approved_at) return NOTHING;

  const changes: PlanChanges = { shifts: [], durations: [], added: [], taskCount: 0 };
  for (const task of state.tasks) {
    if (isBeyondPlan(state, task)) {
      changes.added.push({ kind: "added", task });
      changes.taskCount += 1;
      continue;
    }

    const baseline = baselineOf(task);
    if (baseline === null) continue;

    const shift = daysBetween(baseline.start, task.start_date);
    const stretch = task.duration_days - baseline.duration;
    if (shift === 0 && stretch === 0) continue;

    // Уехавшее начало старше растянутого срока: «когда начнём» — первое, что
    // спрашивают у плана, и задача, у которой поехало и то и другое, читается
    // прежде всего как перенесённая.
    if (shift !== 0) {
      changes.shifts.push({
        kind: "shift",
        task,
        from: baseline.start,
        to: task.start_date,
        days: shift,
        stretch:
          stretch === 0 ? null : { from: baseline.duration, to: task.duration_days },
      });
    } else {
      changes.durations.push({
        kind: "duration",
        task,
        from: baseline.duration,
        to: task.duration_days,
        days: stretch,
      });
    }

    changes.taskCount += 1;
  }

  return changes;
}

/**
 * Разошёлся ли план с тем, что согласовали.
 *
 * Тот же счёт, что показывает чип в шапке: пометка о расхождении и число рядом
 * с ней обязаны появляться и исчезать вместе, а два независимых условия для
 * этого однажды разъехались бы. Отдельного флага «изменён» на проекте
 * по-прежнему нет — он был бы вычислим из базовых полей задач и пережил бы их
 * правку (см. baseline.ts).
 */
export function changedSinceApproval(state: ProjectState): boolean {
  return planChanges(state).taskCount > 0;
}

/**
 * Задачи, которые были в согласованном плане и исчезли.
 *
 * Считаются по снимку версии, а не по состоянию: удалённой задачи в состоянии
 * нет по определению, и её исчезновение — единственное расхождение с планом,
 * которое из одного состояния не видно вовсе. Снимок хранит имя как раз для
 * такого случая.
 *
 * Снимок берётся последней версии — той, с которой план и сравнивают. Список
 * версий приходит новыми вперёд (см. plans.plan_versions), поэтому нужная —
 * первая; порядок здесь всё же не предполагается, а проверяется номером:
 * ответ сервера — данные, а не обещание.
 */
export function removedTasks(
  state: ProjectState,
  approvals: PlanApproval[],
): Extract<PlanChange, { kind: "removed" }>[] {
  if (!state.plan_approved_at || approvals.length === 0) return [];

  const latest = approvals.reduce((a, b) => (b.version > a.version ? b : a));
  const alive = new Set(state.tasks.map((task) => task.id));
  return Object.entries(latest.snapshot)
    .filter(([taskId]) => !alive.has(taskId))
    .map(([taskId, planned]) => ({ kind: "removed" as const, taskId, name: planned.name }));
}
