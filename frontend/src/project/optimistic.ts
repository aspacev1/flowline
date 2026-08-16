import type { ProjectState, Task, TaskStatus } from "../api/projects";
import { addDays } from "../gantt/timescale";

/**
 * Преобразования состояния «как оно будет выглядеть», пока сервер не ответил.
 *
 * Здесь нет и не должно быть календарной арифметики: дату окончания считает
 * сервер, и посчитанная тут «на глаз» она разъедется с настоящей на первом же
 * празднике. Полоска до ответа сдвигается началом, а длину берёт прежнюю —
 * это честнее, чем показать неверный конец уверенно.
 */

export function patchTask(state: ProjectState, taskId: string, patch: Partial<Task>): ProjectState {
  return {
    ...state,
    tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
  };
}

/**
 * Сцепка статуса и прогресса — та же, что на сервере, и только она.
 *
 * Догадка обязана совпасть с будущим ответом: прогресс в сто процентов делает
 * задачу готовой, откат ниже ста возвращает готовую в работу, а «готово»
 * руками доводит прогресс до ста. Больше сервер ничего не выводит — и клиент
 * не должен, иначе полоска мигнёт чужим значением между догадкой и ответом.
 *
 * Правило вынесено двумя чистыми функциями, потому что спрашивают его не
 * только догадки: форма создания задачи сводит те же два поля до отправки —
 * `create_task` кладёт статус и прогресс такими, какими их прислали, и без
 * этой сцепки задача рождалась бы «готовой» с нулём процентов.
 */
export function statusForProgress(status: TaskStatus, pct: number): TaskStatus {
  return pct >= 100 ? "done" : status === "done" ? "in_progress" : status;
}

export function progressForStatus(status: TaskStatus, pct: number): number {
  return status === "done" ? 100 : pct;
}

export function patchProgress(state: ProjectState, taskId: string, pct: number): ProjectState {
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === taskId
        ? { ...task, progress_pct: pct, status: statusForProgress(task.status, pct) }
        : task,
    ),
  };
}

export function patchStatus(state: ProjectState, taskId: string, status: TaskStatus): ProjectState {
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === taskId
        ? { ...task, status, progress_pct: progressForStatus(status, task.progress_pct) }
        : task,
    ),
  };
}

/**
 * Веха схлопывает длительность в один день — та же сцепка, что на сервере, и
 * только она. Снятый признак длительности не трогает: настоящей у вехи не
 * было, и придумывать её на выходе не из чего.
 *
 * Дату окончания догадка не считает — её считает сервер по календарю проекта.
 * Полоска до ответа остаётся прежней ширины и только потом становится ромбом;
 * это честнее, чем показать неверный конец уверенно.
 */
export function patchMilestone(
  state: ProjectState,
  taskId: string,
  milestone: boolean,
): ProjectState {
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === taskId
        ? { ...task, milestone, duration_days: milestone ? 1 : task.duration_days }
        : task,
    ),
  };
}

/**
 * Сдвиг всей категории на N календарных дней.
 *
 * Считается по календарным дням, а не по рабочим, потому что операция задана
 * в них же: полосу тащат по шкале, и деление шкалы — календарный день.
 * Настоящие даты окончания пересчитает сервер по календарю проекта.
 */
export function shiftCategory(
  state: ProjectState,
  categoryId: string,
  days: number,
): ProjectState {
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      task.category_id === categoryId
        ? { ...task, start_date: addDays(task.start_date, days) }
        : task,
    ),
  };
}

/**
 * Задача исчезает вместе со своими связями — ровно так, как сделает каскад на
 * сервере. Оставить связи было бы не осторожностью, а ошибкой: стрелки к
 * несуществующей строке некуда рисовать, и до ответа сервера лента мигала бы
 * ими.
 */
export function deleteTask(state: ProjectState, taskId: string): ProjectState {
  return {
    ...state,
    tasks: state.tasks.filter((task) => task.id !== taskId),
    dependencies: state.dependencies.filter(
      (link) => link.from_task_id !== taskId && link.to_task_id !== taskId,
    ),
  };
}

/**
 * Категория снимается только пустой — непустую сервер откажется удалять
 * (category_not_empty), и отказ откатит догадку. Задачи всё равно фильтруются:
 * догадка не должна уметь показать строки-сироты, даже если её позвали в обход
 * этого правила.
 */
export function deleteCategory(state: ProjectState, categoryId: string): ProjectState {
  return {
    ...state,
    categories: state.categories.filter((category) => category.id !== categoryId),
    tasks: state.tasks.filter((task) => task.category_id !== categoryId),
  };
}

/**
 * Связи — без проверки циклов: их ловит сервер, и отказ откатит догадку.
 * Повторную связь заглушить обязан вызывающий — он же прячет её из списка
 * кандидатов.
 */
export function addDependency(state: ProjectState, from: string, to: string): ProjectState {
  return {
    ...state,
    dependencies: [...state.dependencies, { from_task_id: from, to_task_id: to }],
  };
}

export function removeDependency(state: ProjectState, from: string, to: string): ProjectState {
  return {
    ...state,
    dependencies: state.dependencies.filter(
      (link) => !(link.from_task_id === from && link.to_task_id === to),
    ),
  };
}

/**
 * Строка встаёт на новое место — и соседи расступаются.
 *
 * Позиции пересчитываются целиком по обеим затронутым категориям, а не только
 * у переносимой строки: сервер делает ровно это, и оптимистичный порядок,
 * отличающийся от будущего ответа, дал бы заметный скачок строк при обновлении.
 */
export function reorderTask(
  state: ProjectState,
  taskId: string,
  categoryId: string,
  position: number,
): ProjectState {
  const moved = state.tasks.find((task) => task.id === taskId);
  if (!moved) return state;

  const siblings = state.tasks
    .filter((task) => task.category_id === categoryId && task.id !== taskId)
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));

  // Позиция за концом списка — не ошибка: бросок в самый низ присылает индекс,
  // равный длине.
  const index = Math.min(position, siblings.length);
  const ordered = [...siblings.slice(0, index), moved, ...siblings.slice(index)];

  const places = new Map(ordered.map((task, slot) => [task.id, slot]));
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      places.has(task.id)
        ? { ...task, category_id: categoryId, position: places.get(task.id)! }
        : task,
    ),
  };
}
