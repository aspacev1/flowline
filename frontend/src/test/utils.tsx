import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import { AppRoutes } from "../AppRoutes";
import { AuthProvider } from "../auth/AuthProvider";
import { LocaleProvider } from "../i18n/LocaleProvider";
import type { Locale } from "../i18n";

/**
 * Клиент на один тест, без повторов: повтор упавшего запроса прячет ошибку
 * от теста на несколько секунд и делает падение похожим на таймаут.
 */
export function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function Providers({
  children,
  locale = "az",
  route = "/",
}: {
  children: ReactNode;
  locale?: Locale;
  route?: string;
}) {
  return (
    <QueryClientProvider client={newQueryClient()}>
      <LocaleProvider initial={locale}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options: { locale?: Locale; route?: string } = {},
) {
  return render(<Providers {...options}>{ui}</Providers>);
}

/**
 * Профиль для тестов. `locale` совпадает с языком, в котором рендерится
 * интерфейс: язык профиля побеждает язык браузера, и расхождение здесь
 * означало бы, что тест проверяет не то, что написано в его названии.
 */
export const USER = { id: "u1", name: "Алексей", email: "a@b.c", locale: "ru" };

/** Всё приложение целиком: маршруты, аутентификация, языки — как в бою. */
export function renderApp(options: { route?: string; locale?: Locale } = {}) {
  const { route = "/", locale = "ru" } = options;
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <LocaleProvider initial={locale}>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}
