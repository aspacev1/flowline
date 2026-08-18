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
  // Пояс не выбран: сутки считаются по браузеру — состояние, в котором живёт
  // всякий, кто про эту настройку не вспоминал.
  timezone: null as string | null,
  email_verified: true,
  is_admin: false,
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
  settings: {
    default_locale: "az",
    default_timezone: "Asia/Baku",
    // Понедельник–пятница: бит 0 это понедельник, как считает сервер.
    working_days: 0b11111,
    week_start: 0,
    holiday_calendar: ["2026-03-20"],
    default_shift_threshold_days: 2,
    public_sharing_enabled: true,
    default_comments_enabled: true,
  },
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
    // Переключатель языка сохраняет выбор в профиль — на любом экране, где он
    // есть, то есть на любом защищённом. Тест про проекты не должен объявлять
    // это у себя, но и падать на неописанном запросе он тоже не должен.
    http.patch("/api/auth/me", async ({ request }) => {
      const patch = (await request.json()) as Partial<typeof USER>;
      return HttpResponse.json({ ...USER, ...patch });
    }),
    // Лента комментариев висит на каждом экране проекта, и тест про
    // диаграмму не должен падать на запросе, к которому не имеет отношения.
    // Пустая по умолчанию: тест про разговор объявляет свою и перекрывает
    // эту, потому что регистрируется позже.
    http.get("/api/projects/:projectId/comments", () => HttpResponse.json([])),
    // Состав спрашивает сама диаграмма — для фильтра «Исполнитель». По той же
    // причине, что и комментарии: пустой по умолчанию, тест про владельцев
    // объявляет свой.
    http.get("/api/org/members", () => HttpResponse.json([])),
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
  // Вместе с запросом и якорем: возврат на присланную ссылку обязан сохранять
  // её целиком, а по одному пути этого не увидеть.
  return <span data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</span>;
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
