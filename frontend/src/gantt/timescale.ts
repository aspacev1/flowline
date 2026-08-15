/**
 * Перевод дат в пиксели и обратно.
 *
 * Модуль намеренно не знает про React: перетаскивание будет спрашивать
 * `dateAt(x)` десятки раз в секунду, и проверять этот перевод через отрисовку
 * DOM значило бы проверять его медленно и неточно.
 *
 * Даты внутри — строки ISO, а не объекты `Date`. `new Date("2026-03-01")`
 * разбирается как полночь UTC, а `getDate()` отдаёт день в поясе машины: к
 * западу от Гринвича это уже 28 февраля. Вся арифметика здесь идёт по
 * UTC-полуночи, а наружу отдаются те же строки, что пришли с сервера.
 */

const MS_PER_DAY = 86_400_000;

export type Day = {
  /** Дата в ISO, ровно в том виде, в каком её понимает сервер. */
  date: string;
  /** Номер дня недели по календарю: 0 — воскресенье, как у `getUTCDay`. */
  weekday: number;
  /** День месяца, для подписи в шапке. */
  dayOfMonth: number;
  /** Смещение от начала ленты в пикселях. */
  x: number;
};

export type Month = {
  /** `YYYY-MM` — ключ для React и для сравнения в тестах. */
  key: string;
  /** Сколько дней этого месяца попало в ленту. Крайние месяцы бывают обрезаны. */
  days: number;
  x: number;
  width: number;
};

export type Scale = {
  from: string;
  to: string;
  dayWidth: number;
  /**
   * Признак системы координат: начало ленты и ширина дня.
   *
   * По нему отличают переезд задачи от смены изображения. Полоска, у которой
   * поменялось `left`, могла переехать — а могла остаться на своём дне, пока
   * лента сменила масштаб или раздвинула окно. В первом случае движение надо
   * показать, во втором — нет: это не задача поехала, это лента стала другой,
   * и «переезжающие» разом все полоски читались бы как обвал плана.
   */
  key: string;
  days: Day[];
  months: Month[];
  width: number;
  /** Левый край дня в пикселях. */
  xOf: (date: string) => number;
  /** Ширина отрезка, включая оба конца: однодневная задача занимает один день. */
  widthOf: (startISO: string, endISO: string) => number;
  /** Дата, внутрь которой попала координата. За краями ленты — её края. */
  dateAt: (x: number) => string;
};

/** ISO-строка → миллисекунды UTC-полуночи. */
export function toUtc(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Миллисекунды UTC-полуночи → ISO-строка. */
export function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Сколько календарных дней от одной даты до другой. Отрицательное, если вторая раньше. */
export function daysBetween(fromISO: string, toISO_: string): number {
  return Math.round((toUtc(toISO_) - toUtc(fromISO)) / MS_PER_DAY);
}

/** Дата, сдвинутая на заданное число календарных дней. */
export function addDays(iso: string, days: number): string {
  return toISO(toUtc(iso) + days * MS_PER_DAY);
}

export function buildScale({
  from,
  to,
  dayWidth,
}: {
  from: string;
  to: string;
  dayWidth: number;
}): Scale {
  const start = toUtc(from);
  // Обе границы включительно: лента из одного дня — это один день, а не ноль.
  const count = Math.max(1, Math.round((toUtc(to) - start) / MS_PER_DAY) + 1);

  const days: Day[] = [];
  const months: Month[] = [];

  for (let index = 0; index < count; index += 1) {
    const moment = new Date(start + index * MS_PER_DAY);
    const date = moment.toISOString().slice(0, 10);
    days.push({
      date,
      // По календарю, а не по остатку от деления индекса: индекс знает только
      // расстояние от начала ленты, и при сдвиге границы окна такой расчёт
      // разъезжается с настоящим днём недели.
      weekday: moment.getUTCDay(),
      dayOfMonth: moment.getUTCDate(),
      x: index * dayWidth,
    });

    const key = date.slice(0, 7);
    const last = months.at(-1);
    if (last && last.key === key) {
      last.days += 1;
      last.width += dayWidth;
    } else {
      months.push({ key, days: 1, x: index * dayWidth, width: dayWidth });
    }
  }

  const width = count * dayWidth;

  return {
    from,
    to,
    dayWidth,
    key: `${from}:${dayWidth}`,
    days,
    months,
    width,
    xOf: (date) => daysBetween(from, date) * dayWidth,
    widthOf: (startISO, endISO) => (daysBetween(startISO, endISO) + 1) * dayWidth,
    dateAt: (x) => {
      // Прижимаем к краям, а не отдаём undefined: курсор при перетаскивании
      // регулярно уезжает за ленту, и разбираться с этим каждому вызывающему
      // отдельно значит однажды забыть.
      const index = Math.min(count - 1, Math.max(0, Math.floor(x / dayWidth)));
      return days[index].date;
    },
  };
}
