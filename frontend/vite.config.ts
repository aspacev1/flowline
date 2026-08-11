import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // В разработке фронт и бэк живут на разных портах. Прокси избавляет от CORS
  // и заодно делает куку сессии однодоменной — иначе браузер её не сохранит.
  // Адрес бэкенда переопределяется переменной окружения: порт 8000 бывает
  // занят уже поднятым контейнером, и тогда единственная альтернатива —
  // править конфигурацию руками и не забыть вернуть.
  server: {
    proxy: { "/api": process.env.API_TARGET ?? "http://localhost:8000" },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
