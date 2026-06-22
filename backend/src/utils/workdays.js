// Рабочие дни (5-дневная неделя, без праздников).
// duration везде означает количество РАБОЧИХ дней.
// start считается первым рабочим днём задачи.

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function daysBetween(a, b) {
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

// конечная дата задачи длиной duration рабочих дней, начиная со start
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

// сколько рабочих дней (включительно) между двумя датами a и b
export function workDaysBetween(a, b) {
  if (b < a) return -workDaysBetween(b, a);
  let count = 0;
  let d = new Date(a);
  while (d <= b) {
    if (!isWeekend(d)) count++;
    d = addDays(d, 1);
  }
  return count;
}

export const HOURS_PER_DAY = 8;

export function isOverEstimate(durationDays, loggedHours) {
  return durationDays > 0 && loggedHours > durationDays * HOURS_PER_DAY;
}

export function isExtended(originalEndDate, currentEnd) {
  if (!originalEndDate) return false;
  return daysBetween(new Date(originalEndDate), currentEnd) > 0;
}

export function extensionDays(originalEndDate, currentEnd) {
  if (!originalEndDate) return 0;
  return daysBetween(new Date(originalEndDate), currentEnd);
}
