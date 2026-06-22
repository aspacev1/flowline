// Хелперы дат, включая расчёт по рабочим дням (5-дневная неделя).

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}
export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
export function fmtDate(d) {
  return new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
export function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}
export function isWeekend(d) {
  const day = new Date(d).getDay();
  return day === 0 || day === 6;
}

export const today = new Date();
today.setHours(0, 0, 0, 0);

export function workEndDate(start, duration) {
  if (duration <= 0) return new Date(start);
  let d = new Date(start);
  while (isWeekend(d)) d = addDays(d, 1);
  let remaining = duration - 1;
  while (remaining > 0) {
    d = addDays(d, 1);
    if (!isWeekend(d)) remaining--;
  }
  return d;
}

export function workDaysBetween(a, b) {
  let start = new Date(a);
  let end = new Date(b);
  if (end < start) return -workDaysBetween(end, start);
  let count = 0;
  let d = new Date(start);
  while (d <= end) {
    if (!isWeekend(d)) count++;
    d = addDays(d, 1);
  }
  return count;
}

export function currentEndDate(item) {
  return workEndDate(item.start, item.duration);
}

export function isOverEstimate(item) {
  return item.duration > 0 && item.loggedHours > item.duration * 8;
}

export function isExtended(item) {
  if (!item.originalEndDate) return false;
  return daysBetween(item.originalEndDate, currentEndDate(item)) > 0;
}

export function extensionDays(item) {
  if (!item.originalEndDate) return 0;
  return daysBetween(item.originalEndDate, currentEndDate(item));
}
