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
 * спрашивают «когда это делается», и ровно то, что стоит показывать по
 * умолчанию. Остальные включаются в меню «Вид».
 */
export const DEFAULT_SHOWN: readonly ColumnKey[] = ["task", "start", "end"];

export type ColumnLayout = {
  /** Показанные колонки в порядке отрисовки. `task` всегда первая. */
  shown: ColumnKey[];
  widths: Record<ColumnKey, number>;
  /**
   * Таблица свёрнута: от неё осталась узкая полоса с кнопкой, а шкала занимает
   * всё освободившееся место.
   *
   * Свойство раскладки, а не отдельное состояние: это тот же вопрос «сколько
   * места отдано таблице», что и набор колонок с их ширинами, и живёт он там
   * же — в браузере, привязанным к проекту. Свёрнутая таблица переживает уход
   * на историю и обратно: полугодовой план разворачивают, чтобы увидеть его
   * целиком, а не чтобы увидеть на один переход между вкладками.
   */
  collapsed: boolean;
};

/**
 * Ширина свёрнутой таблицы: полоса ровно под кнопку, которая её вернёт.
 *
 * Не ноль: развернуть таблицу было бы нечем — кнопка живёт в ней самой, а
 * второе место для неё (тулбар) означало бы искать её не там, где она свернула
 * то, что сворачивала.
 */
export const COLLAPSED_WIDTH = 36;

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
    // Развёрнутой: лента открывается таблицей и шкалой, а не одной шкалой —
    // без имён задач по полоскам не понять, о чём они.
    collapsed: false,
  };
}

/**
 * Общая ширина закреплённой колонки — по ней встают шапка, строки и прокрутка.
 *
 * У свёрнутой таблицы это ширина полосы с кнопкой, а не сумма колонок: колонки
 * никуда не делись — их набор и ширины ждут разворота, — но места на ленте они
 * в этот момент не занимают.
 */
export function layoutWidth(layout: ColumnLayout): number {
  if (layout.collapsed) return COLLAPSED_WIDTH;
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

    const { shown, widths, collapsed } = parsed as {
      shown?: unknown;
      widths?: unknown;
      collapsed?: unknown;
    };
    if (!Array.isArray(shown)) return null;

    // Порядок читается из хранилища: колонки переставляют местами за
    // заголовок, и порядок — такой же выбор человека, как их набор. Проверять
    // его всё равно надо: в записи от будущей версии может лежать незнакомое
    // имя, повтор или пропущенное имя колонки.
    const seen = new Set<ColumnKey>();
    const visible = shown.filter((key): key is ColumnKey => {
      if (!isColumnKey(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Имя задачи всегда первое и всегда есть: строка без него — строка, по
    // которой нельзя понять, о чём она.
    const ordered: ColumnKey[] = ["task", ...visible.filter((key) => key !== "task")];
    const sizes = { ...DEFAULT_WIDTH };
    if (typeof widths === "object" && widths !== null) {
      for (const [key, value] of Object.entries(widths)) {
        if (isColumnKey(key) && typeof value === "number" && Number.isFinite(value)) {
          sizes[key] = clampWidth(value);
        }
      }
    }
    // Свёртка читается как признак, а не как «что угодно правдивое»: в записи
    // от будущей версии на этом месте может лежать строка, и `Boolean("нет")`
    // открыл бы ленту свёрнутой, ничего никому не объяснив.
    return { shown: ordered, widths: sizes, collapsed: collapsed === true };
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

/**
 * Колонка включена или выключена.
 *
 * Включённая встаёт не в конец, а на своё место по объявленному порядку — но
 * только среди тех, которых человек не переставлял: порядок принадлежит ему,
 * и колонка, случайно выключенная и включённая обратно, не должна перетасовать
 * то, что он выстроил. Поэтому вставка ищет первую показанную колонку, которая
 * по объявленному порядку идёт после включаемой, и встаёт перед ней.
 */
export function toggleColumn(shown: ColumnKey[], column: ColumnKey): ColumnKey[] {
  if (column === "task") return shown;
  if (shown.includes(column)) return shown.filter((key) => key !== column);

  const natural = COLUMN_KEYS.indexOf(column);
  const at = shown.findIndex((key) => COLUMN_KEYS.indexOf(key) > natural);
  return at === -1
    ? [...shown, column]
    : [...shown.slice(0, at), column, ...shown.slice(at)];
}

/**
 * Колонка, перенесённая на место другой.
 *
 * Имя задачи с первого места не уходит и на него никого не пускает: это
 * единственная колонка, по которой строка опознаётся, и вторая за ней читалась
 * бы как заголовок строки. Поэтому и бросок на неё, и бросок её самой просто
 * ничего не меняют — молча, без объяснений: объяснять нечего, человек тянул
 * колонку и увидел, что она не тянется.
 */
export function reorderColumns(
  shown: ColumnKey[],
  moved: ColumnKey,
  before: ColumnKey,
): ColumnKey[] {
  if (moved === "task" || before === "task" || moved === before) return shown;
  const rest = shown.filter((key) => key !== moved);
  const at = rest.indexOf(before);
  if (at === -1) return shown;
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}
