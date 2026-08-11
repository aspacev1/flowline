import type { Locale, Params } from "./index";

type Translate = (key: string, params?: Params) => string;

/**
 * Названия месяцев и дней недели берутся из словарей, а не у `Intl`.
 *
 * Причина не в принципе, а в проверке живьём: ICU в браузере знает локаль
 * `az`, но названий месяцев для неё не содержит и молча падает на корневую
 * локаль — `Intl.DateTimeFormat("az", { month: "long" })` отдаёт «M09» вместо
 * «sentyabr», а узкий день недели — латинскую букву английского названия. Для
 * языка, который в этом продукте стоит по умолчанию, это не мелкий дефект
 * оформления: половина шкалы перестаёт читаться.
 *
 * Заодно исчезает зависимость от того, с какой сборкой ICU собран конкретный
 * браузер: одни и те же подписи у всех.
 */

/** Номер месяца из ISO-строки, от 1 до 12. */
function monthNumber(iso: string): number {
  return Number(iso.slice(5, 7));
}

/** «15 сентября» — день с месяцем в форме, которой требует язык. */
export function formatDate(t: Translate, iso: string): string {
  return t("calendar.date", {
    day: Number(iso.slice(8, 10)),
    month: t(`calendar.month_in.${monthNumber(iso)}`),
  });
}

/**
 * «15 сен» — та же дата в тесноте.
 *
 * Отдельная форма, а не обрезка полной: в карточке и в ленте истории дата
 * стоит рядом с другими словами и в узкой колонке, и «15 сентября» там
 * переносится на вторую строку. Сокращения тоже из словарей — по той же
 * причине, что и полные названия.
 */
export function formatShortDate(t: Translate, iso: string): string {
  return t("calendar.date_short", {
    day: Number(iso.slice(8, 10)),
    month: t(`calendar.month_short.${monthNumber(iso)}`),
  });
}

/** «сентябрь 2026» — подпись месяца в шапке ленты. */
export function formatMonth(t: Translate, iso: string): string {
  return t("calendar.month_year", {
    month: t(`calendar.month.${monthNumber(iso)}`),
    year: Number(iso.slice(0, 4)),
  });
}

/**
 * «14:32» — час и минута по часам того, кто смотрит.
 *
 * Единственное место в этом файле, где спрашивают `Intl`, и это не
 * противоречие сказанному выше: пробел в данных ICU для `az` касается
 * названий — месяцев и дней недели, — а здесь одни цифры и разделитель.
 * Формат при этом всё равно решает язык: английский читатель ждёт «2:32 PM»
 * там, где русский и азербайджанский ждут «14:32».
 *
 * Часовой пояс — местный, а не проектный: «данные на 14:32» человек сверяет с
 * часами на своей стене, а не с настройкой проекта.
 */
export function formatTime(locale: Locale, at: number | Date): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(at);
}

/** Узкая подпись дня недели: 0 — воскресенье, как у `getUTCDay`. */
export function weekdayNarrow(t: Translate, weekday: number): string {
  return t(`calendar.weekday.${weekday}`);
}
