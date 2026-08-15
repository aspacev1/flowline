/**
 * Сегодняшний день по часам читателя.
 *
 * «Сегодня» в этом продукте — не момент времени, а день календаря: по нему
 * стоит линия сегодняшнего дня на ленте, считается ожидаемая готовность
 * задачи и решается, просрочена ли она. Взятое обрезкой `toISOString()`, оно
 * считалось по UTC — и у читателя в UTC+3 с полуночи до трёх утра «сегодня»
 * было вчерашним числом: линия стояла не там, а отметка дня уходила в
 * прошедшие сутки.
 *
 * Поэтому день здесь собирается из полей календаря в нужном поясе, а не
 * обрезкой ISO-строки. Пояс приходит снаружи — из профиля, проекта или
 * браузера (см. useToday.ts): этот модуль сознательно ничего не знает ни про
 * React, ни про то, чей это пояс.
 *
 * Арифметика дат живёт в gantt/timescale.ts и остаётся UTC-полуночной: там
 * даты — строки с сервера, у которых нет ни часа, ни пояса. Единственное
 * место, где пояс вообще нужен, — переход «момент времени → день», и он тут.
 */

/** Часовой пояс машины, на которой открыта страница. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    // Пояс — единственное, чего может не оказаться у `Intl`; остальное
    // приложение на нём и так держится. Пустота здесь честнее выдуманного
    // «UTC»: она означает «спросить у самой машины» (см. machineDay).
    return undefined;
  }
}

/**
 * Форматтеры кэшируются: `dateAt` при перетаскивании и перерисовка ленты
 * спрашивают день десятки раз в секунду, а построение `Intl.DateTimeFormat`
 * — самая дорогая часть этого перевода.
 *
 * `null` в кэше — память о том, что имя пояса непригодно: второй раз
 * поднимать на нём исключение незачем.
 */
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;

  let formatter: Intl.DateTimeFormat | null = null;
  try {
    // Календарь и цифры заданы в самой локали: без них читатель с
    // персидским или арабским календарём в настройках системы получил бы
    // «۱۴۰۵-۰۵-۲۴» — строку, которую сервер не понимает и которая не
    // сравнивается с датами задач.
    formatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // Имя пояса приходит из профиля и настроек проекта, где его проверил
    // сервер по базе IANA. Но браузер бывает старее этой базы, и падать на
    // незнакомом ему поясе всей страницей нельзя: день просто считается по
    // часам машины.
    formatter = null;
  }
  formatters.set(timeZone, formatter);
  return formatter;
}

/** Сутки по часам самой машины — то же, что показывают её часы. */
function machineDay(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * Какой день календаря идёт в этом поясе в указанный момент.
 *
 * Без пояса — по часам машины: это ровно то, что человек видит на своей
 * стене, и лучшее приближение, пока пояс неизвестен.
 */
export function dayIn(
  timeZone: string | null | undefined,
  at: number | Date = Date.now(),
): string {
  const moment = typeof at === "number" ? new Date(at) : at;
  const formatter = timeZone ? formatterFor(timeZone) : null;
  if (formatter === null) return machineDay(moment);

  // formatToParts, а не format: `en-CA` пишет дату как «2026-03-04», но
  // разбирать чужой формат строкой значит однажды получить «2026-03-04 н.э.»
  // и не заметить этого.
  const parts = formatter.formatToParts(moment);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = field("year");
  const month = field("month");
  const day = field("day");
  if (year === "" || month === "" || day === "") return machineDay(moment);
  return `${year}-${month}-${day}`;
}

/**
 * Имена поясов для выбора в настройках.
 *
 * Список даёт сам браузер: держать свою копию базы IANA значило бы
 * состариться вместе с ней, а сервер всё равно проверяет выбранное имя по
 * своей. `include` — значения, которые обязаны быть в списке, даже если
 * браузер их не знает: уже сохранённый выбор человека и пояс его машины.
 * Иначе поле выбора молча показало бы не то, что записано в профиле.
 */
export function timeZoneNames(...include: (string | null | undefined)[]): string[] {
  let known: readonly string[] = [];
  try {
    known = Intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    known = [];
  }
  const names = new Set(known);
  for (const name of include) {
    if (name) names.add(name);
  }
  return [...names].sort();
}
