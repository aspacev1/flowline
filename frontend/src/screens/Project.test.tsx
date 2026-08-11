import { screen } from "@testing-library/react";
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
});
