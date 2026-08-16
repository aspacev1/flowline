import type { ProjectState, Task } from "../api/projects";
import { daysBetween } from "../gantt/timescale";
import { changedSinceApproval } from "./baseline";
import { progressOf, statusCounts } from "./progress";

/**
 * Вердикт по проекту: одна строка, отвечающая на «нужно ли сюда вмешиваться».
 *
 * Карточку в списке не читают — на неё смотрят, поэтому вердикт один, а не
 * шесть значков рядом: шесть значков читаются как ноль. Состояния сложены в
 * лестницу, и побеждает первое подошедшее — самое срочное из тех, что верны
 * одновременно. Заблокированный черновик без дат покажет блокировку: даты
 * назначают когда угодно, а блокировка держит работу сейчас.
 *
 * Здесь же живут обе величины просрочки. Их две, и это не дубль: они отвечают
 * на разные вопросы и до этого модуля считались в трёх местах по-своему.
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

export type VerdictKind =
  /** Проект заведён, работы в нём нет. */
  | "empty"
  /** Срок задачи прошёл, работа не закончена. */
  | "overdue"
  /** Проект целиком не влезает в дедлайн. */
  | "late"
  | "blocked"
  /** План разошёлся с тем, что согласовали. */
  | "changed"
  /** Относительный план: дат нет, старт не назначен. */
  | "unscheduled"
  /** План есть, согласования не было. */
  | "draft"
  | "done"
  | "on_track";

/** Цвет вердикта. Тревога — красным, внимание — янтарным, как всюду в теме. */
export type VerdictTone = "alarm" | "warn" | "neutral" | "calm";

export type Verdict = {
  kind: VerdictKind;
  tone: VerdictTone;
  /** Сколько задач — у вердиктов, которые считаются в задачах. */
  count?: number;
  /** Сколько дней — у тех, что меряются днями. */
  days?: number;
};

export function projectVerdict(state: ProjectState, today: string): Verdict {
  // Пустой проект — первым, а не по срочности: без задач все остальные
  // вердикты вычисляются в «всё хорошо», и карточка сказала бы «идёт по
  // плану» про проект, в котором нет ни строки.
  if (state.tasks.length === 0) return { kind: "empty", tone: "neutral" };

  const overdue = overdueTasks(state, today).length;
  if (overdue > 0) return { kind: "overdue", tone: "alarm", count: overdue };

  const late = deadlineOverrunDays(state);
  if (late !== null) return { kind: "late", tone: "alarm", days: late };

  const blocked = statusCounts(state.tasks).blocked;
  if (blocked > 0) return { kind: "blocked", tone: "warn", count: blocked };

  if (changedSinceApproval(state)) return { kind: "changed", tone: "warn" };

  // Завершённый проект выше черновика и относительного плана: у сделанной
  // работы не спрашивают дату старта и не зовут согласовывать план.
  if (progressOf(state.tasks) === 100) return { kind: "done", tone: "calm" };

  // Порядок этих двух — порядок жизни плана: наполнить, назначить старт,
  // согласовать. Относительный план и есть несогласованный черновик почти
  // всегда, и звать согласовывать план без дат раньше, чем назначены даты,
  // значило бы предлагать второй шаг вместо первого.
  if (state.schedule_mode === "relative") return { kind: "unscheduled", tone: "neutral" };
  if (state.plan_approved_at === null) return { kind: "draft", tone: "neutral" };

  return { kind: "on_track", tone: "calm" };
}

/**
 * Насколько вердикт срочен — ключ сортировки карточек.
 *
 * Отдельная таблица, а не порядок лестницы выше: там «пусто» проверяется
 * первым по необходимости (без задач остальное бессмысленно), а срочен он
 * куда меньше просрочки. Совпадающие числа — сознательно: черновик и план без
 * дат зовут к одному и тому же столу, и порядок между ними держит сортировка
 * по месту в списке.
 */
const SEVERITY: Record<VerdictKind, number> = {
  overdue: 7,
  late: 6,
  blocked: 5,
  changed: 4,
  unscheduled: 3,
  draft: 3,
  empty: 2,
  on_track: 1,
  done: 0,
};

export function severityOf(verdict: Verdict | null): number {
  // Проект, сводка которого ещё не пришла, встаёт между «идёт по плану» и
  // «завершён»: утверждать про него что-то более определённое нечем.
  return verdict === null ? 1 : SEVERITY[verdict.kind];
}
