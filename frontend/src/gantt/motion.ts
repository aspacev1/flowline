import { useEffect, useState } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";

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
