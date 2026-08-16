/**
 * Колонки закреплённой части ленты — таблица слева от шкалы.
 *
 * До этого колонка была одна: название задачи. Всё остальное — сроки,
 * длительность, процент, исполнители — жило в карточке, то есть открывалось по
 * одной задаче за раз. Сравнить сроки десяти задач глазами так нельзя вовсе,
 * а именно этим и занимаются, глядя на диаграмму.
 *
 * Набор колонок и их ширины — состояние экрана, а не проекта: сосед по проекту
 * не должен получать чужую раскладку. Живут в браузере, привязанные к проекту,
 * по той же причине, что и масштаб (см. scalePreference.ts).
 */

export const COLUMN_KEYS = ["task", "start", "end", "duration", "progress", "assignee"] as const;

export type ColumnKey = (typeof COLUMN_KEYS)[number];

/**
 * Колонка названия не выключается: строка без имени задачи — это строка, по
 * которой нельзя понять, о чём она. Поэтому она не входит в набор
 * переключаемых и всегда идёт первой.
 */
export const OPTIONAL_COLUMNS = COLUMN_KEYS.filter((key) => key !== "task");

/**
 * Ширины по умолчанию. Название — то же число, что стояло в стилях, пока
 * колонка была одна: лента не должна перерисоваться иначе оттого, что у неё
 * появилась возможность показать больше.
 */
export const DEFAULT_WIDTH: Record<ColumnKey, number> = {
  task: 260,
  start: 104,
  end: 104,
  duration: 84,
  progress: 76,
  assignee: 132,
};

/** Ниже этого колонка перестаёт быть колонкой и становится полоской пикселей. */
export const MIN_WIDTH = 56;
export const MAX_WIDTH = 480;

/**
 * Что видно при первом открытии: имя и обе даты.
 *
 * Не всё сразу: шесть колонок съедают половину экрана, и лента, ради которой
 * сюда пришли, оказывается в оставшейся щели. Три — то, на что смотрят, когда
 * спрашивают «когда это делается», и ровно то, что показывает TeamGantt из
 * коробки. Остальные включаются в меню «Вид».
 */
export const DEFAULT_SHOWN: readonly ColumnKey[] = ["task", "start", "end"];

export type ColumnLayout = {
  /** Показанные колонки в порядке отрисовки. `task` всегда первая. */
  shown: ColumnKey[];
  widths: Record<ColumnKey, number>;
};

/**
 * Ширина окна, ниже которой таблица открывается одной колонкой имени, и
 * ширины этой колонки на узких экранах.
 *
 * Точки те же, что были у ленты в стилях, и по той же причине: на экране в
 * 520 пикселей три колонки по умолчанию съели бы больше места, чем достаётся
 * самой ленте — ради которой сюда и пришли. Живут в коде, а не в медиазапросе,
 * потому что ширина закреплённой колонки теперь не задаётся стилем вовсе: она
 * равна сумме ширин показанных колонок, и медиазапрос её молча не перебьёт.
 *
 * Это умолчание, а не запрет: включить любую колонку и растянуть её можно и на
 * телефоне, и выбор запомнится.
 */
const NARROW_PX = 900;
const VERY_NARROW_PX = 520;
const NARROW_TASK_WIDTH = 240;
const VERY_NARROW_TASK_WIDTH = 180;

export function defaultLayout(width = typeof window === "undefined" ? 0 : window.innerWidth): ColumnLayout {
  // Ноль — окна нет вовсе (серверная отрисовка, тест без jsdom): тогда
  // раскладка обычная, а не самая тесная. Догадка о телефоне там, где о
  // ширине неизвестно ничего, была бы хуже отсутствия догадки.
  const narrow = width > 0 && width <= NARROW_PX;
  const cramped = width > 0 && width <= VERY_NARROW_PX;
  return {
    shown: narrow ? ["task"] : [...DEFAULT_SHOWN],
    widths: {
      ...DEFAULT_WIDTH,
      task: cramped
        ? VERY_NARROW_TASK_WIDTH
        : narrow
          ? NARROW_TASK_WIDTH
          : DEFAULT_WIDTH.task,
    },
  };
}

/** Общая ширина закреплённой колонки — по ней встают шапка, строки и прокрутка. */
export function layoutWidth(layout: ColumnLayout): number {
  return layout.shown.reduce((total, key) => total + layout.widths[key], 0);
}

const STORAGE_PREFIX = "planora.gantt_columns.";

function isColumnKey(value: unknown): value is ColumnKey {
  return typeof value === "string" && (COLUMN_KEYS as readonly string[]).includes(value);
}

/**
 * Раскладка колонок этого проекта, как её оставили в прошлый раз.
 *
 * Прочитанное проверяется по полю, а не принимается на веру: в хранилище лежит
 * то, что туда положила прошлая версия ленты, а у неё мог быть другой набор
 * колонок. Кривая запись — это `null`, то есть «показать по умолчанию», а не
 * лента с колонкой-призраком.
 *
 * Приватный режим браузера умеет запрещать localStorage — тогда раскладка
 * просто не переживёт переход между экранами. Это не повод падать.
 */
export function storedLayout(projectId: string): ColumnLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + projectId);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const { shown, widths } = parsed as { shown?: unknown; widths?: unknown };
    if (!Array.isArray(shown)) return null;

    // Порядок задаёт код, а не хранилище: колонки идут в объявленном порядке,
    // и запись из будущей версии не должна уметь переставить их местами.
    const visible = COLUMN_KEYS.filter((key) => key === "task" || shown.includes(key));
    const sizes = { ...DEFAULT_WIDTH };
    if (typeof widths === "object" && widths !== null) {
      for (const [key, value] of Object.entries(widths)) {
        if (isColumnKey(key) && typeof value === "number" && Number.isFinite(value)) {
          sizes[key] = clampWidth(value);
        }
      }
    }
    return { shown: visible, widths: sizes };
  } catch {
    return null;
  }
}

export function rememberLayout(projectId: string, layout: ColumnLayout): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(layout));
  } catch {
    // см. storedLayout()
  }
}

export function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}
