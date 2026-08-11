import type { Op, ProjectState, Task } from "../api/projects";
import { daysBetween } from "../gantt/timescale";

/**
 * Отклонение от базового плана — то же правило, что и на сервере.
 *
 * Повторение здесь не заменяет серверную проверку и не спорит с ней: решает
 * всё равно сервер, а это нужно для того, чтобы окно с причиной появлялось
 * сразу при отпускании мыши, а не после отказа по сети. Разойтись эти два
 * счёта не могут: оба считают ровно одно — расстояние до базового плана, и
 * обе цифры берутся из одного и того же состояния.
 */

/** Порог по умолчанию, если сервер не прислал разрешённых настроек. */
const FALLBACK_THRESHOLD_DAYS = 2;

export function thresholdOf(state: ProjectState): number {
  return state.settings?.shift_threshold_days ?? FALLBACK_THRESHOLD_DAYS;
}

/**
 * Базовый план задачи, если он есть.
 *
 * Одно место, где решается «есть или нет», — и одно место, где отсутствующее
 * поле приравнивается к пустому. Второе важно: состояние приходит и от
 * сервера, и из оптимистичных правок, и роль без части полей однажды
 * получилась бы «с базовым планом из undefined». Нулевая длительность в
 * условие попадает заодно и безвредно: сервер меньше одного дня не принимает.
 */
export function baselineOf(
  task: Task,
): { start: string; duration: number; end: string } | null {
  const { baseline_start: start, baseline_duration: duration, baseline_end: end } = task;
  if (!start || !duration || !end) return null;
  return { start, duration, end };
}

/**
 * Задача, добавленная после утверждения плана.
 *
 * Базового плана у неё нет и не будет до переутверждения: добавление работы
 * нормально, объяснений оно не требует — объяснений требует скрытый перенос
 * сроков.
 */
export function isBeyondPlan(state: ProjectState, task: Task): boolean {
  return Boolean(state.plan_approved_at) && baselineOf(task) === null;
}

/**
 * Насколько задача разошлась с базовым планом, в днях.
 *
 * `null` — сравнивать не с чем. Значения `start_date` и `duration_days`
 * можно подменить: именно так проверяется правка, которую ещё не отправили.
 */
export function deviationDays(
  task: Task,
  next: { start_date?: string; duration_days?: number } = {},
): number | null {
  const baseline = baselineOf(task);
  if (baseline === null) return null;
  const start = next.start_date ?? task.start_date;
  const duration = next.duration_days ?? task.duration_days;
  return Math.max(
    Math.abs(daysBetween(baseline.start, start)),
    Math.abs(duration - baseline.duration),
  );
}

/**
 * Сдвиг окончания относительно базового плана — то, что показывает бейдж.
 *
 * Именно окончание, а не старт: оно одно отвечает на вопрос «когда это будет
 * готово» и вбирает в себя и перенос начала, и растяжение срока. `null` —
 * базового плана нет, бейджа тоже.
 */
export function endShiftDays(task: Task): number | null {
  const baseline = baselineOf(task);
  if (baseline === null) return null;
  return daysBetween(baseline.end, task.end_date);
}

export type ShiftRequest = {
  taskName: string;
  deviationDays: number;
  thresholdDays: number;
};

/**
 * Требует ли эта операция причины — и какие числа показать в окне.
 *
 * `null` означает «не требует»: либо операция вовсе не про сроки, либо плана
 * ещё нет, либо отклонение укладывается в порог.
 */
export function shiftNeedingReason(state: ProjectState, op: Op): ShiftRequest | null {
  if (op.type !== "move_task" && op.type !== "set_duration") return null;

  const task = state.tasks.find((row) => row.id === op.task_id);
  if (!task) return null;

  const deviation = deviationDays(
    task,
    op.type === "move_task"
      ? { start_date: op.start_date }
      : { duration_days: op.duration_days },
  );
  if (deviation === null) return null;

  const threshold = thresholdOf(state);
  if (deviation <= threshold) return null;
  return { taskName: task.name, deviationDays: deviation, thresholdDays: threshold };
}
