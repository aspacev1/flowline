import { useEffect, useState } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";

/**
 * Длительность переходов ленты в миллисекундах.
 *
 * Живёт здесь, а не только в CSS, по той же причине, что и `ROW_HEIGHT`:
 * переезд полоски анимируется из кода (см. `useBarMotion`), и второе такое же
 * число в стилях разошлось бы с этим при первой правке. Разметка ставит эту
 * величину переменной `--motion`, и CSS берёт её оттуда.
 */
export const MOTION_MS = 180;

/**
 * Просил ли человек меньше движения — разовый ответ, без подписки.
 *
 * Нужен там, где значение читают в момент действия, а не держат в состоянии:
 * анимацию полоски запускает код, и общее правило `transition: none` из
 * styles.css её не видит — оно гасит переходы CSS, а не то, что заведено
 * через `Element.animate`. Подписываться ради одного чтения нечем: полосок на
 * ленте сотни, и это были бы сотни слушателей одной и той же настройки.
 */
export function prefersReducedMotion(): boolean {
  return ask();
}

/**
 * Просил ли человек меньше движения.
 *
 * Настройка системная, и уважать её обязательно: для части людей движение на
 * экране — это не «менее приятно», а тошнота и головная боль. Поэтому переходы
 * при ней выключаются целиком, а не ускоряются: быстрое движение — всё ещё
 * движение.
 *
 * Слежение живое, а не разовое: настройку меняют, не перезагружая вкладку.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => ask());

  useEffect(() => {
    // Ни matchMedia, ни подписки может не быть — в jsdom нет первого, в старых
    // движках второго. Отсутствие ответа значит «не просил»: это то же
    // поведение, что и сегодня, и оно не хуже.
    const list = typeof matchMedia === "function" ? matchMedia(REDUCED) : null;
    if (!list?.addEventListener) return;

    const listen = (event: MediaQueryListEvent) => setReduced(event.matches);
    list.addEventListener("change", listen);
    return () => list.removeEventListener("change", listen);
  }, []);

  return reduced;
}

function ask(): boolean {
  return typeof matchMedia === "function" && matchMedia(REDUCED).matches;
}
