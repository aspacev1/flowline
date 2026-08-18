import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import { USER, renderApp, sessionHandlers } from "../test/utils";

const ROSTER = [
  {
    id: "u1",
    name: "Алексей",
    email: "alex@example.com",
    created_at: "2026-08-01T09:00:00+00:00",
    last_active_at: "2026-08-17T14:32:00+00:00",
    organizations: ["Acme"],
  },
  {
    id: "u2",
    name: "Мария",
    email: "maria@example.com",
    created_at: "2026-08-15T09:00:00+00:00",
    last_active_at: null,
    organizations: [],
  },
];

function adminHandlers(
  options: { isDirector?: boolean; roster?: unknown[] | null } = {},
) {
  const { isDirector = true, roster = ROSTER } = options;
  return [
    http.get("/api/auth/me", () => HttpResponse.json({ ...USER, is_director: isDirector })),
    http.get("/api/admin/users", () =>
      roster === null
        ? HttpResponse.json({ detail: "forbidden" }, { status: 403 })
        : HttpResponse.json(roster),
    ),
    http.get("/api/projects", () => HttpResponse.json([])),
    ...sessionHandlers(),
  ];
}

describe("панель директора", () => {
  it("пункт колонки виден только директору", async () => {
    server.use(...adminHandlers({ isDirector: true }));
    renderApp({ route: "/projects", locale: "ru" });

    expect(await screen.findByRole("link", { name: "Админ-панель" })).toBeInTheDocument();
  });

  it("не показывает пункт колонки тому, кто не носит роль директора", async () => {
    server.use(...adminHandlers({ isDirector: false }));
    renderApp({ route: "/projects", locale: "ru" });

    await screen.findByRole("heading", { name: "Проекты" });
    expect(screen.queryByRole("link", { name: "Админ-панель" })).toBeNull();
  });

  it("показывает регистрацию, организацию и последнюю активность", async () => {
    server.use(...adminHandlers());
    renderApp({ route: "/admin", locale: "ru" });

    expect(await screen.findByText("Алексей")).toBeInTheDocument();
    expect(screen.getByText("alex@example.com")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("человек без организации читается как «без организации», а не пустой строкой", async () => {
    server.use(...adminHandlers());
    renderApp({ route: "/admin", locale: "ru" });

    await screen.findByText("Мария");
    expect(screen.getByText("без организации")).toBeInTheDocument();
  });

  it("аккаунт без активности подписан отдельно, а не пустой ячейкой", async () => {
    server.use(...adminHandlers());
    renderApp({ route: "/admin", locale: "ru" });

    await screen.findByText("Мария");
    expect(screen.getByText("ещё не заходил")).toBeInTheDocument();
  });

  it("поиск фильтрует по имени и почте", async () => {
    server.use(...adminHandlers());
    renderApp({ route: "/admin", locale: "ru" });

    await screen.findByText("Алексей");

    await userEvent.type(screen.getByPlaceholderText("Имя или адрес…"), "мари");

    await waitFor(() => expect(screen.queryByText("Алексей")).toBeNull());
    expect(screen.getByText("Мария")).toBeInTheDocument();
  });

  it("не-директор получает тот же отказ, что и любой другой закрытый маршрут", async () => {
    server.use(...adminHandlers({ isDirector: false, roster: null }));
    renderApp({ route: "/admin", locale: "ru" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Для этого у вас нет прав");
  });
});
