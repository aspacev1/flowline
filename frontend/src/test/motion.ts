import { vi } from "vitest";

/**
 * `matchMedia`, которого у jsdom нет вовсе.
 *
 * Настройка «меньше движения» — это системное предпочтение, и спросить о нём
 * можно только через `matchMedia`. Без подстановки приложение под тестом не
 * узнало бы о нём никогда, и проверка уважения к этой настройке проверяла бы
 * лишь то, что код не падает.
 */
export function matchMediaMock(query: string, matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (asked: string) => ({
      matches: asked === query ? matches : false,
      media: asked,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
}
