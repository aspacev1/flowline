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
  categories: [
    { id: "c1", name: "Дизайн", color: "#3b82f6", position: 0 },
    { id: "c2", name: "Аналитика", color: "#a855f7", position: 1 },
  ],
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

const MEMBERS = [
  { id: "u1", name: "Алексей", email: "a@b.c", role: "owner" },
  { id: "u2", name: "Nigar", email: "n@b.c", role: "editor" },
];

/** Открыть форму плюсом на строке категории «Дизайн». */
async function openTaskForm() {
  await userEvent.click(await screen.findByRole("button", { name: /добавить задачу в «Дизайн»/i }));
}

async function fillTaskForm({
  name,
  start,
  days,
}: {
  name: string;
  start: string;
  days: number;
}) {
  await openTaskForm();
  await userEvent.type(screen.getByLabelText(/^название/i), name);
  await userEvent.clear(screen.getByLabelText(/дата старта/i));
  await userEvent.type(screen.getByLabelText(/дата старта/i), start);
  await userEvent.clear(screen.getByLabelText(/рабочих дней/i));
  await userEvent.type(screen.getByLabelText(/рабочих дней/i), String(days));
  await userEvent.click(screen.getByRole("button", { name: /создать задачу/i }));
}

describe("создание задачи", () => {
  it("подставляет категорию, из строки которой открыли форму", async () => {
    server.use(
      // Свой состав — раньше общего из sessionHandlers: msw берёт первый
      // подходящий обработчик в списке.
      http.get("/api/org/members", () => HttpResponse.json(MEMBERS)),
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });
    await userEvent.click(
      await screen.findByRole("button", { name: /добавить задачу в «Дизайн»/i }),
    );

    expect(screen.getByLabelText(/категория/i)).toHaveValue("c1");
  });

  it("подпись плюса называет категорию, а не повторяет «добавить»", async () => {
    server.use(
      // Свой состав — раньше общего из sessionHandlers: msw берёт первый
      // подходящий обработчик в списке.
      http.get("/api/org/members", () => HttpResponse.json(MEMBERS)),
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });

    // На десятке категорий одинаковые подписи неразличимы при чтении с экрана.
    expect(await screen.findByRole("button", { name: /добавить задачу в «Дизайн»/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /добавить задачу в «Аналитика»/i })).toBeInTheDocument();
  });

  it("отправляет операцию с длительностью в рабочих днях", async () => {
    const sent: { op: Record<string, unknown> }[] = [];
    server.use(
      // Свой состав — раньше общего из sessionHandlers: msw берёт первый
      // подходящий обработчик в списке.
      http.get("/api/org/members", () => HttpResponse.json(MEMBERS)),
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
      http.post("/api/projects/p1/mutations", async ({ request }) => {
        sent.push((await request.json()) as { op: Record<string, unknown> });
        return HttpResponse.json({ seq: 3, op: {}, inverse: {} }, { status: 201 });
      }),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });
    await fillTaskForm({ name: "Макеты", start: "2026-03-19", days: 14 });

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].op).toMatchObject({
      type: "create_task",
      category_id: "c1",
      name: "Макеты",
      start_date: "2026-03-19",
      duration_days: 14,
    });
    // Позицию назначает сервер: она не входит в публичный контракт.
    expect(sent[0].op).not.toHaveProperty("position");
    expect(sent[0].op).not.toHaveProperty("task_id");
  });

  it("переводит отказ сервера по коду, а не показывает detail", async () => {
    server.use(
      // Свой состав — раньше общего из sessionHandlers: msw берёт первый
      // подходящий обработчик в списке.
      http.get("/api/org/members", () => HttpResponse.json(MEMBERS)),
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
      http.post("/api/projects/p1/mutations", () =>
        HttpResponse.json({ detail: "task_limit_reached" }, { status: 422 }),
      ),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });
    await fillTaskForm({ name: "Макеты", start: "2026-03-19", days: 14 });

    expect(await screen.findByText(/слишком много задач/i)).toBeInTheDocument();
    expect(screen.queryByText("task_limit_reached")).not.toBeInTheDocument();
  });

  it("не даёт длительность меньше одного дня", async () => {
    server.use(
      // Свой состав — раньше общего из sessionHandlers: msw берёт первый
      // подходящий обработчик в списке.
      http.get("/api/org/members", () => HttpResponse.json(MEMBERS)),
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });
    await openTaskForm();
    await userEvent.clear(screen.getByLabelText(/рабочих дней/i));
    await userEvent.type(screen.getByLabelText(/рабочих дней/i), "0");

    expect(screen.getByRole("button", { name: /создать задачу/i })).toBeDisabled();
  });

  it("показывает исполнителей и отправляет их отдельными операциями", async () => {
    const sent: { op: Record<string, unknown> }[] = [];
    server.use(
      // Свой состав — раньше общего из sessionHandlers: msw берёт первый
      // подходящий обработчик в списке.
      http.get("/api/org/members", () => HttpResponse.json(MEMBERS)),
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
      http.post("/api/projects/p1/mutations", async ({ request }) => {
        const body = (await request.json()) as { op: Record<string, unknown> };
        sent.push(body);
        return HttpResponse.json(
          {
            seq: sent.length + 2,
            // Идентификатор новой задачи приходит с сервера: без него
            // назначать исполнителей не на кого.
            op: body.op.type === "create_task" ? { task_id: "t9" } : {},
            inverse: {},
          },
          { status: 201 },
        );
      }),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });
    await openTaskForm();
    await userEvent.type(screen.getByLabelText(/^название/i), "Макеты");
    await userEvent.click(screen.getByRole("checkbox", { name: /Nigar/ }));
    await userEvent.click(screen.getByRole("button", { name: /создать задачу/i }));

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].op).toEqual({ type: "assign_user", task_id: "t9", user_id: "u2" });
  });

  it("роль без права на состав организации не ломает форму", async () => {
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
      // Роль client этот маршрут не получает вовсе.
      http.get("/api/org/members", () => HttpResponse.json({ detail: "forbidden" }, { status: 403 })),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });
    await openTaskForm();

    // Блока исполнителей просто нет — форма при этом работает.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^название/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /создать задачу/i })).toBeInTheDocument();
  });

  it("критичность отправляется выбранная, а не всегда обычная", async () => {
    const sent: { op: Record<string, unknown> }[] = [];
    server.use(
      // Свой состав — раньше общего из sessionHandlers: msw берёт первый
      // подходящий обработчик в списке.
      http.get("/api/org/members", () => HttpResponse.json(MEMBERS)),
      ...sessionHandlers(),
      http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
      http.post("/api/projects/p1/mutations", async ({ request }) => {
        sent.push((await request.json()) as { op: Record<string, unknown> });
        return HttpResponse.json({ seq: 3, op: {}, inverse: {} }, { status: 201 });
      }),
    );

    renderApp({ route: "/projects/p1", locale: "ru" });
    await openTaskForm();
    await userEvent.type(screen.getByLabelText(/^название/i), "Макеты");
    await userEvent.selectOptions(screen.getByLabelText(/критичность/i), "critical");
    await userEvent.click(screen.getByRole("button", { name: /создать задачу/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].op).toMatchObject({ criticality: "critical" });
  });
});
