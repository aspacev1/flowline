import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./server";

// `onUnhandledRequest: "error"` выбран сознательно: запрос, который тест не
// описал, обязан ронять тест, а не молча уходить в никуда.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
