import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  ScorecardMetric,
  ScorecardMetricKey,
  ScorecardState,
} from "../api/scorecard";
import { projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";

/**
 * Скоркард по фикстуре: просрочка в красном с серией, средняя просрочка с
 * дробью (запятая в ru — её проверяет отдельное утверждение), качество данных
 * с расшифровкой, оба вида событий справа. daily_health в no_data — строки в
 * таблице быть не должно.
 */
function metric(
  over: Partial<ScorecardMetric> & { key: ScorecardMetricKey },
): ScorecardMetric {
  return {
    direction: "lte",
    target: 2,
    enabled: true,
    owner: null,
    value: 0,
    status: "ok",
    streak: 1,
    history: [
      { week_start: "2026-08-10", value: 0, status: "ok" },
      { week_start: "2026-08-17", value: over.value ?? 0, status: over.status ?? "ok" },
    ],
    ...over,
  };
}

const SCORECARD: ScorecardState = {
  week: { number: 34, start: "2026-08-17", end: "2026-08-23" },
  computed_at: "2026-08-19T10:00:00+00:00",
  metrics: [
    metric({ key: "overdue_tasks", value: 5, status: "risk", streak: 3 }),
    metric({ key: "avg_overdue_days", target: 3, value: 3.5, status: "warn" }),
    metric({ key: "date_shifts", target: 5, value: 1 }),
    metric({
      key: "close_rate",
      direction: "gte",
      target: 1,
      value: 0.5,
      status: "risk",
      streak: 1,
    }),
    metric({ key: "stale_in_progress", target: 3, value: 0 }),
    metric({
      key: "unassigned_tasks",
      target: 0,
      value: 1,
      status: "warn",
      owner: { id: "u2", name: "Мария" },
    }),
    metric({ key: "daily_health", direction: "gte", target: 8, value: null, status: "no_data" }),
    metric({ key: "data_quality", direction: "gte", target: 90, value: 80, status: "warn" }),
  ],
  alerts: [
    {
      id: "al1",
      metric_key: "overdue_tasks",
      kind: "metric_risk",
      week_start: "2026-08-17",
      created_at: "2026-08-17T08:00:00+00:00",
      payload: {
        value: 5,
        total: 5,
        tasks: [
          { id: "t1", name: "Логотип", assignee: "Алексей", days_overdue: 4 },
          { id: "tx", name: "Гайдлайн", assignee: null, days_overdue: 2 },
        ],
      },
    },
    {
      id: "al2",
      metric_key: "close_rate",
      kind: "rule_triggered",
      week_start: "2026-08-17",
      created_at: "2026-08-17T08:00:00+00:00",
      payload: { task_id: "t1", task_name: "Разобрать: Закрываемость" },
    },
  ],
  daily: null,
  data_quality: { value: 80, total: 10, unassigned: 1, unreal_deadline: 1 },
};

describe("Scorecard", () => {
  beforeEach(() => {
    projectFixtures();
    server.use(
      http.get("/api/projects/p1/scorecard", () => HttpResponse.json(SCORECARD)),
    );
  });

  it("показывает метрики: значения, серию, качество данных — и прячет дейли", async () => {
    renderProject(undefined, { route: "/projects/p1/scorecard" });

    expect(await screen.findByText("Просроченные задачи")).toBeInTheDocument();
    // Дробь — с запятой: десятичные в ru приходят от Intl.
    expect(screen.getByText("3,5")).toBeInTheDocument();
    // Серия в бейдже — с двух недель.
    expect(screen.getByText(/Риск · 3 нед\./)).toBeInTheDocument();
    // Модуля дейли нет: метрика в no_data не показывается вовсе.
    expect(screen.queryByText("Здоровье дейли")).not.toBeInTheDocument();
    // Правая колонка: расшифровка качества данных.
    expect(
      screen.getByText("у 1 задач нет реальных сроков, у 1 — нет исполнителя"),
    ).toBeInTheDocument();
    // События: топ просроченных и след правила со ссылкой на задачу.
    expect(screen.getByText("Открыть все задачи (5) →")).toBeInTheDocument();
    expect(screen.getByText("Разобрать: Закрываемость")).toBeInTheDocument();
  });

  it("разворачивает список задач недели и ведёт из него в карточку на ленте", async () => {
    server.use(
      http.get("/api/projects/p1/scorecard/metrics/overdue_tasks/tasks", () =>
        HttpResponse.json({
          metric_key: "overdue_tasks",
          week_start: "2026-08-17",
          value: 5,
          details: {
            tasks: [
              {
                id: "t1",
                name: "Логотип",
                status: "in_progress",
                end_date: "2026-08-12",
                assignees: ["Алексей"],
                days_overdue: 4,
              },
            ],
          },
        }),
      ),
    );
    renderProject(undefined, { route: "/projects/p1/scorecard" });

    await userEvent.click(await screen.findByText("Просроченные задачи"));
    // Точнее, чем просто «Логотип»: та же задача стоит ссылкой в карточке
    // события справа, а здесь ищется строка drill-down с припиской метрики.
    const entry = await screen.findByRole("button", { name: /Логотип.*просрочка/ });
    expect(entry).toHaveTextContent("просрочка 4 раб. дн.");

    // Щелчок по задаче — переход на ленту с открытой карточкой: адрес меняется
    // на вкладку диаграммы.
    await userEvent.click(entry);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(/\/projects\/p1$/),
    );
  });

  it("правит цель и владельца PATCH-ем", async () => {
    const patched: unknown[] = [];
    server.use(
      http.patch(
        "/api/projects/p1/scorecard/metrics/overdue_tasks",
        async ({ request }) => {
          patched.push(await request.json());
          return HttpResponse.json(SCORECARD);
        },
      ),
    );
    renderProject(undefined, { route: "/projects/p1/scorecard" });

    const target = await screen.findByLabelText("Цель метрики «Просроченные задачи»");
    await userEvent.clear(target);
    await userEvent.type(target, "4");
    await userEvent.tab();
    await waitFor(() => expect(patched).toContainEqual({ target_value: 4 }));

    const owner = screen.getByLabelText("Владелец метрики «Просроченные задачи»");
    await userEvent.selectOptions(owner, "u2");
    await waitFor(() => expect(patched).toContainEqual({ owner_user_id: "u2" }));
  });

  it("пересчитывает по кнопке и прячет запись от читателя", async () => {
    let recalculated = 0;
    server.use(
      http.post("/api/projects/p1/scorecard/recalculate", () => {
        recalculated += 1;
        return HttpResponse.json(SCORECARD);
      }),
    );
    renderProject(undefined, { route: "/projects/p1/scorecard" });

    await userEvent.click(await screen.findByRole("button", { name: "Пересчитать" }));
    await waitFor(() => expect(recalculated).toBe(1));
  });

  it("читателю не показывает ни пересчёта, ни правки настроек", async () => {
    renderProject(undefined, { canWrite: false, route: "/projects/p1/scorecard" });

    expect(await screen.findByText("Просроченные задачи")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Пересчитать" })).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Цель метрики «Просроченные задачи»"),
    ).not.toBeInTheDocument();
    // Владелец без права записи — подписью, не списком выбора.
    expect(screen.getByText("Мария")).toBeInTheDocument();
  });

  it("пустая панель событий говорит, что всё в норме", async () => {
    server.use(
      http.get("/api/projects/p1/scorecard", () =>
        HttpResponse.json({ ...SCORECARD, alerts: [] }),
      ),
    );
    renderProject(undefined, { route: "/projects/p1/scorecard" });

    expect(await screen.findByText("Всё в норме")).toBeInTheDocument();
  });
});
