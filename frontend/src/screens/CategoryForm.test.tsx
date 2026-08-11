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

async function createCategoryNamed(name: string) {
  await userEvent.click(await screen.findByRole("button", { name: /категория/i }));
  await userEvent.type(screen.getByLabelText(/название/i), name);
  await userEvent.click(screen.getByRole("button", { name: /^создать$/i }));
}

describe("создание категории", () => {
  it("отправляет операцию создания категории и обновляет диаграмму", async () => {
    const sent: unknown[] = [];
    let reread = 0;
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => {
        reread += 1;
        return HttpResponse.json(
          reread === 1
            ? STATE
            : {
                ...STATE,
                categories: [
                  ...STATE.categories,
                  { id: "c2", name: "Аналитика", color: "#a855f7", position: 1 },
                ],
              },
        );
      }),
      http.post("/api/projects/p1/mutations", async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ seq: 2, op: {}, inverse: {} }, { status: 201 });
      }),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });
    await createCategoryNamed("Аналитика");

    await waitFor(() =>
      expect(sent).toEqual([
        {
          op: {
            type: "create_category",
            name: "Аналитика",
            color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
          },
        },
      ]),
    );

    // Состояние перезапрашивается, а не дописывается в кэш руками: позицию и
    // идентификатор назначил сервер, и придуманные клиентом разошлись бы с
    // ними в самом неудобном месте.
    expect(await screen.findByText("Аналитика")).toBeInTheDocument();
  });

  it("не шлёт в операции полей, которых нет в публичном контракте", async () => {
    // position и category_id назначает сервер; клиент их не знает и знать не должен
    const sent: { op: Record<string, unknown> }[] = [];
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
      http.post("/api/projects/p1/mutations", async ({ request }) => {
        sent.push((await request.json()) as { op: Record<string, unknown> });
        return HttpResponse.json({ seq: 2, op: {}, inverse: {} }, { status: 201 });
      }),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });
    await createCategoryNamed("Аналитика");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].op).not.toHaveProperty("position");
    expect(sent[0].op).not.toHaveProperty("category_id");
  });

  it("предлагает цвет, но оставляет выбор человеку", async () => {
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /категория/i }));

    const color = screen.getByLabelText<HTMLInputElement>(/цвет/i);
    expect(color.value).toMatch(/^#[0-9a-f]{6}$/i);
    // Цвет предлагается по числу уже существующих категорий, а не берётся
    // первым из палитры: иначе две подряд созданные категории неразличимы.
    expect(color.value).not.toBe(STATE.categories[0].color);
  });

  it("не даёт отправить пустое название", async () => {
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /категория/i }));

    expect(screen.getByRole("button", { name: /^создать$/i })).toBeDisabled();
  });

  it("объясняет отказ сервера переведённым текстом, а не кодом", async () => {
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
      http.post("/api/projects/p1/mutations", () =>
        HttpResponse.json({ detail: "forbidden" }, { status: 403 }),
      ),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });
    await createCategoryNamed("Аналитика");

    expect(await screen.findByText(/у вас нет прав/i)).toBeInTheDocument();
    expect(screen.queryByText("forbidden")).not.toBeInTheDocument();
  });
});
