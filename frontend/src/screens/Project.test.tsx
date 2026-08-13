import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import { renderApp, sessionHandlers } from "../test/utils";

const STATE = {
  id: "p1",
  name: "Редизайн",
  slug: "redizayn",
  deadline: "2026-06-01",
  project_end: "2026-06-08",
  calendar: { working_days: 31, holidays: ["2026-03-20"], extra_workdays: [] },
  settings: { shift_threshold_days: 2, timezone: "Asia/Baku" },
  categories: [{ id: "c1", name: "Дизайн", color: "#3b82f6", position: 0 }],
  tasks: [
    {
      id: "t1",
      category_id: "c1",
      name: "Логотип",
      description: "",
      start_date: "2026-03-04",
      end_date: "2026-03-10",
      duration_days: 5,
      criticality: "high",
      progress_pct: 40,
      position: 0,
      assignee_ids: [],
    },
  ],
  dependencies: [],
};

describe("экран проекта", () => {
  it("показывает диаграмму, когда состояние пришло", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects/p1", () => HttpResponse.json(STATE)));

    renderApp({ route: "/projects/p1", locale: "ru" });

    expect(await screen.findByRole("button", { name: /Логотип/ })).toBeInTheDocument();
    // Название проекта — содержимое пользователя, оно не переводится.
    expect(screen.getByRole("heading", { name: "Редизайн" })).toBeInTheDocument();
  });

  it("подписывает исполнителей в карточке наведения именами из состава", async () => {
    server.use(
      // Раньше оснастки: из обработчиков одного вызова msw берёт первый
      // подходящий, и объявленный после пустой состав так и остался бы пустым.
      http.get("/api/org/members", () =>
        HttpResponse.json([
          { id: "u1", name: "Алексей", email: "a@b.c", role: "owner" },
          { id: "u2", name: "Мария", email: "m@b.c", role: "editor" },
        ]),
      ),
      ...sessionHandlers(),
      http.get("/api/projects/p1", () =>
        HttpResponse.json({
          ...STATE,
          tasks: [{ ...STATE.tasks[0], status: "in_progress", assignee_ids: ["u1", "u2"] }],
        }),
      ),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });

    await userEvent.hover(await screen.findByRole("button", { name: /Логотип/ }));

    // Имена приходят с рабочего экрана: сама лента за составом не ходит.
    await waitFor(() => expect(screen.getByTestId("bar-tip")).toHaveTextContent("Алексей +1"));
  });

  it("несуществующий и чужой проект неразличимы и объясняются словами", async () => {
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects/p1", () =>
        HttpResponse.json({ detail: "project_not_found" }, { status: 404 }),
      ),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });

    expect(await screen.findByText(/проект не найден/i)).toBeInTheDocument();
    // Пустая диаграмма вместо объяснения читалась бы как «проект пуст».
    expect(screen.queryByRole("button", { name: /Логотип/ })).not.toBeInTheDocument();
  });

  it("пока состояние не пришло, диаграмма не рисуется", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects/p1", () => HttpResponse.json(STATE)));

    renderApp({ route: "/projects/p1", locale: "ru" });

    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    await screen.findByRole("button", { name: /Логотип/ });
  });

  it("настройки проекта — в шапке проекта, а не в общем меню и не в кебабе", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects/p1", () => HttpResponse.json(STATE)));

    renderApp({ route: "/projects/p1", locale: "ru" });

    await screen.findByRole("heading", { name: "Редизайн" });
    // Рядом с названием проекта и с подлежащим в подписи: «Настройки» без него
    // в колонке рядом ведут в настройки рабочего пространства.
    const settings = screen.getByRole("link", { name: "Настройки проекта" });
    expect(settings).toHaveAttribute("href", "/projects/p1/settings");
    expect(settings.closest(".project-head")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Настройки" })).toHaveAttribute("href", "/settings");
    // Кебаб «⋯» не рисуется — в нём был единственный пункт, и тот переехал.
    expect(screen.queryByRole("button", { name: /Ещё действия/i })).not.toBeInTheDocument();
  });
});
