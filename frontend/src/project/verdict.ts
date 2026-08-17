import type { ProjectState, Task } from "../api/projects";
import { daysBetween } from "../gantt/timescale";

/**
 * Просрочка проекта: две разные величины с похожим именем.
 *
 * «Задача просрочена» — работа не закончена, а её срок уже прошёл;
 * «проект не влезает в дедлайн» — общий срок проекта нарушен, посчитанный в
 * днях, а не в задачах. По-русски оба зовутся «просрочено», но отвечают на
 * разные вопросы и до этого модуля считались в нескольких местах по-своему —
 * здесь им одно место на двоих.
 */

/**
 * Просрочена ли задача: работа не закончена, а её срок уже прошёл.
 *
 * Только у календарного плана. У относительного даты задач — координаты на
 * оси от RELATIVE_EPOCH (2001-01-01), а не настоящие сроки: сравнение с
 * сегодняшним днём пометило бы просроченной каждую строку такого проекта.
 */
export function isTaskOverdue(state: ProjectState, task: Task, today: string): boolean {
  if (state.schedule_mode !== "calendar") return false;
  return task.status !== "done" && task.end_date < today;
}

/** Просроченные задачи проекта. Считаются в задачах: их открывают поимённо. */
export function overdueTasks(state: ProjectState, today: string): Task[] {
  return state.tasks.filter((task) => isTaskOverdue(state, task, today));
}

/**
 * Задачи, кончающиеся позже дедлайна проекта.
 *
 * Не то же, что просрочка выше, хотя по-русски оба зовутся «просрочено». Та
 * отвечает на «работа стоит, а время вышло», эта — на «в срок ли». Отсюда
 * пересечение с завершёнными: сделанное после дедлайна сделано не в срок, и
 * из этого счёта оно не уходит.
 *
 * Относительному плану ничего не грозит и без проверки режима: его координаты
 * лежат в 2001 году и дедлайна не перешагивают.
 */
export function pastDeadlineTasks(state: ProjectState): Task[] {
  const { deadline } = state;
  if (deadline === null) return [];
  return state.tasks.filter((task) => task.end_date > deadline);
}

/**
 * На сколько дней проект не влезает в дедлайн. `null` — укладывается либо
 * сравнивать не с чем.
 *
 * Днями, а не задачами: «шесть задач за дедлайном» не отвечает, опоздание это
 * на день или на месяц, а «+14 дней» отвечает сразу.
 */
export function deadlineOverrunDays(state: ProjectState): number | null {
  if (state.schedule_mode !== "calendar") return null;
  if (state.deadline === null || state.project_end === null) return null;
  const overrun = daysBetween(state.deadline, state.project_end);
  return overrun > 0 ? overrun : null;
}
