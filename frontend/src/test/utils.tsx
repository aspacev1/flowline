import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";

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
export const USER = {
  id: "u1",
  name: "Алексей",
  email: "a@b.c",
  locale: "ru",
  email_verified: true,
};

/**
 * Организация для тестов. Название нарочно азербайджанское: содержимое
 * пользователя не переводится ни при каком языке интерфейса, и заметно это
 * только на названии, которое не совпадает с языком экрана.
 */
export const ORG = {
  id: "o1",
  name: "Şəhər Studiyası",
  slug: "seher-studiyasi",
  role: "owner",
};

/**
 * Ответы, без которых защищённый маршрут не открывается вовсе: профиль и
 * организация. Тест про проекты не должен переписывать их у себя — иначе
 * половина его текста будет про вход, а не про то, что он проверяет. Идут
 * первыми, чтобы `server.use` теста мог перекрыть любой из них.
 */
export function sessionHandlers() {
  return [
    http.get("/api/auth/me", () => HttpResponse.json(USER)),
    http.get("/api/org", () => HttpResponse.json(ORG)),
    // Лента комментариев висит на каждом экране проекта, и тест про
    // диаграмму не должен падать на запросе, к которому не имеет отношения.
    // Пустая по умолчанию: тест про разговор объявляет свою и перекрывает
    // эту, потому что регистрируется позже.
    http.get("/api/projects/:projectId/comments", () => HttpResponse.json([])),
  ];
}

/**
 * Текущий адрес, вынесенный в разметку.
 *
 * Переход после успешного действия — наблюдаемое поведение, и проверять его
 * надо так же, как его видит человек: по тому, куда он попал. Подмена
 * `useNavigate` вместо этого проверяла бы, что компонент вызвал функцию, —
 * и продолжала бы зеленеть, если бы маршрута по этому адресу не было вовсе.
 */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

/** Всё приложение целиком: маршруты, аутентификация, языки — как в бою. */
export function renderApp(options: { route?: string; locale?: Locale } = {}) {
  const { route = "/", locale = "ru" } = options;
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <LocaleProvider initial={locale}>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            <AppRoutes />
            <LocationProbe />
          </AuthProvider>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}
