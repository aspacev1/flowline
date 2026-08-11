import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./server";

// Запрос, который тест не описал, обязан ронять тест, а не молча уходить в
// никуда. Одного `onUnhandledRequest: "error"` для этого мало: приложение
// ловит отказ сети само и превращает его в «сервер недоступен», так что тест
// продолжает зеленеть на несуществующем ответе. Поэтому такие запросы
// копятся и предъявляются после теста.
const undeclared: string[] = [];

beforeAll(() =>
  server.listen({
    onUnhandledRequest: (request, print) => {
      undeclared.push(`${request.method} ${request.url}`);
      print.error();
    },
  }),
);

afterEach(() => {
  server.resetHandlers();
  // Язык — единственное, что приложение помнит между сессиями. Не почистить
  // его значит уронить соседний тест выбором, сделанным в этом.
  localStorage.clear();

  const seen = undeclared.splice(0);
  if (seen.length > 0) {
    throw new Error(`тест не описал запросы: ${seen.join(", ")}`);
  }
});

afterAll(() => server.close());
