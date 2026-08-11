import type { Calendar, ProjectState } from "../api/projects";
import { addDays, toISO, toUtc } from "./timescale";

/**
 * Ширина дня в пикселях. Живёт в браузере, а не на сервере: это масштаб
 * изображения, а не свойство плана. Масштабирование появится позже; пока одно
 * значение на всех, и оно здесь, чтобы разметка и тесты называли одно и то же
 * число одним именем.
 */
export const DAY_WIDTH = 26;

/** Первое число месяца, в который попала дата. */
function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Последнее число месяца, в который попала дата. */
function lastOfMonth(iso: string): string {
  const moment = new Date(toUtc(iso));
  // Нулевой день следующего месяца — последний день текущего. Считать
  // «тридцать дней, кроме февраля» руками незачем.
  return toISO(Date.UTC(moment.getUTCFullYear(), moment.getUTCMonth() + 1, 0));
}

/**
 * Границы ленты.
 *
 * Окно натягивается на всё, что диаграмма обязана показать: задачи, дедлайн и
 * посчитанное сервером окончание проекта. Дедлайн включён отдельно от задач
 * потому, что он рисуется вертикалью — за краем ленты её просто не видно, и
 * человек решит, что дедлайна нет.
 *
 * Сегодняшний день в окно не входит: проект, спланированный на прошлую весну,
 * растянул бы ленту на год пустоты. Метка сегодня рисуется, только если день
 * и так попал в окно.
 *
 * Края округляются до месяца: шапка с обрезанным первым месяцем читается как
 * ошибка вёрстки.
 */
export function projectWindow(state: ProjectState): { from: string; to: string } {
  const dates = [
    ...state.tasks.map((task) => task.start_date),
    ...state.tasks.map((task) => task.end_date),
    ...(state.deadline ? [state.deadline] : []),
    ...(state.project_end ? [state.project_end] : []),
  ];

  if (dates.length === 0) {
    // Ни одной даты — окно вокруг сегодняшнего дня: пустой проект всё равно
    // должен показать шкалу, иначе экран выглядит сломанным.
    const today = toISO(Date.now());
    return { from: firstOfMonth(today), to: lastOfMonth(addDays(today, 30)) };
  }

  // Строки ISO сравниваются лексикографически ровно как даты: у них
  // фиксированная ширина полей и старший разряд слева.
  const earliest = dates.reduce((a, b) => (a < b ? a : b));
  const latest = dates.reduce((a, b) => (a > b ? a : b));
  return { from: firstOfMonth(earliest), to: lastOfMonth(latest) };
}

/**
 * Рабочий ли это день по календарю проекта.
 *
 * Порядок применения тот же, что на сервере: маска дней недели, затем
 * праздники их убирают, затем `extra_workdays` возвращают конкретные даты
 * обратно. Повторение правила здесь — не расчёт дат: даты считает сервер.
 * Это заливка фона, и без неё человек ставит задачу на воскресенье, не
 * замечая этого.
 */
export function isWorkingDay(date: string, calendar: Calendar, weekday: number): boolean {
  if (calendar.extra_workdays.includes(date)) return true;
  if (calendar.holidays.includes(date)) return false;
  // Маска пришла из Python, где понедельник — нулевой бит. `weekday` пришёл
  // из `getUTCDay`, где нулевое — воскресенье. Без этого перевода залитыми
  // оказываются воскресенье с понедельником вместо субботы с воскресеньем.
  const mondayFirst = (weekday + 6) % 7;
  return (calendar.working_days & (1 << mondayFirst)) !== 0;
}
