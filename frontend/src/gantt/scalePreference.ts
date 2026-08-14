import type { Zoom } from "./scale";

const STORAGE_PREFIX = "planora.gantt_scale.";

const ZOOMS: readonly Zoom[] = ["day", "week", "month"];

function isZoom(value: string | null): value is Zoom {
  return value !== null && (ZOOMS as readonly string[]).includes(value);
}

/**
 * Последний выбранный масштаб ленты для этого проекта.
 *
 * Масштаб живёт в браузере, привязанным к проекту, а не в одном общем ключе:
 * человек листает несколько проектов подряд, и годовой портфель с недельным
 * масштабом не должен подменять собой дневной масштаб спринта. Переключение
 * вкладки «История» и обратно, уход на другой экран и возврат — всё это
 * размонтирует ленту, и без памяти здесь она открывалась бы заново на
 * «дне», как будто выбора и не было.
 *
 * Приватный режим браузера умеет запрещать localStorage — тогда масштаб
 * просто не переживёт переход между экранами. Это не повод падать (см.
 * LocaleProvider и guestName.ts, тот же приём).
 */
export function storedZoom(projectId: string): Zoom | null {
  try {
    const value = localStorage.getItem(STORAGE_PREFIX + projectId);
    return isZoom(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberZoom(projectId: string, zoom: Zoom): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + projectId, zoom);
  } catch {
    // см. storedZoom()
  }
}
