import type { Task, TaskStatus } from "../api/projects";

/**
 * Готовность набора задач, взвешенная по длительности.
 *
 * Взвешивание выбрано явно (см. разбор макета, §9.3): равновесное среднее
 * считало бы день и месяц одинаковыми вкладами, и категория с готовой
 * однодневкой и нетронутым месяцем показывала бы «50%». Доля дневной работы —
 * то, что человек и имеет в виду под «готово на две трети».
 *
 * Одна функция на категорию, проект и отчёт: три свёртки в трёх местах
 * разошлись бы на первом же спорном проценте.
 */
export function progressOf(tasks: Task[]): number | null {
  if (tasks.length === 0) return null;
  const total = tasks.reduce((sum, task) => sum + task.duration_days, 0);
  if (total === 0) return null;
  const done = tasks.reduce((sum, task) => sum + task.duration_days * task.progress_pct, 0);
  return Math.round(done / total);
}

/** Сколько задач в каждом статусе. Нули на месте: отчёту нужны все колонки. */
export function statusCounts(tasks: Task[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { planned: 0, in_progress: 0, done: 0, blocked: 0 };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}
