import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { ProposalState } from "../api/proposal";
import { projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";

/**
 * Смета с двумя строками: 2 × 100 и 3 × 200 — сумма 800, налог 10% — 80,
 * итого 880, трудоёмкость 5 дней. Числа выбраны так, чтобы каждая строка
 * итогов отличалась от любой другой и от цен строк: совпадение двух сумм
 * позволило бы тесту зеленеть на перепутанных строках.
 */
const PROPOSAL: ProposalState = {
  effort_unit: "days",
  hours_per_day: 8,
  tax_rate_pct: 10,
  currency: "USD",
  categories: [
    {
      id: "pc1",
      name: "Дизайн",
      position: 0,
      tasks: [
        {
          id: "pt1",
          category_id: "pc1",
          name: "Логотип",
          description: "Знак",
          details: "Три варианта",
          role: "Дизайнер",
          effort: 2,
          rate: 100,
          notes: "Шрифт покупает клиент",
          risks: "Правки затянутся",
          assumptions: "Брендбук уже есть",
          position: 0,
          comment_count: 1,
        },
        {
          id: "pt2",
          category_id: "pc1",
          name: "Гайдлайн",
          description: "",
          details: "",
          role: "",
          effort: 3,
          rate: 200,
          notes: "",
          risks: "",
          assumptions: "",
          position: 1,
          comment_count: 0,
        },
      ],
    },
  ],
};

/**
 * Деньги — тем же Intl, что и экран: точная строка зависит от ICU среды.
 *
 * Неразрывный пробел приводится к обычному: getByText нормализует пробелы в
 * тексте элемента, но не в искомой строке, и «600,00 $» с U+00A0 не находил
 * бы сам себя.
 */
function money(value: number): string {
  return new Intl.NumberFormat("ru", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })
    .format(value)
    .replace(/\s/g, " ");
}

function proposalFixtures(state: ProposalState = PROPOSAL) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  server.use(
    http.get("/api/projects/p1/proposal", () => HttpResponse.json(state)),
    http.get("/api/projects/p1/proposal/tasks/:taskId/comments", () =>
      HttpResponse.json([
        {
          id: "k1",
          task_id: "pt1",
          body: "Ставку согласовали",
          created_at: "2026-03-05T10:00:00+00:00",
          author: { name: "Мария", guest: false },
        },
      ]),
    ),
    http.post("/api/projects/p1/proposal/categories/:categoryId/tasks", async ({ request, params }) => {
      sent.push({
        method: "POST",
        path: `tasks:${params.categoryId as string}`,
        body: await request.json(),
      });
      return HttpResponse.json(
        { id: "pt-new", category_id: params.categoryId, name: "Новая" },
        { status: 201 },
      );
    }),
    http.post("/api/projects/p1/proposal/categories", async ({ request }) => {
      sent.push({ method: "POST", path: "categories", body: await request.json() });
      return HttpResponse.json({ id: "pc-new", name: "Ещё", position: 1 }, { status: 201 });
    }),
    http.patch("/api/projects/p1/proposal/tasks/:taskId", async ({ request, params }) => {
      sent.push({
        method: "PATCH",
        path: `task:${params.taskId as string}`,
        body: await request.json(),
      });
      return HttpResponse.json(state);
    }),
    http.post("/api/projects/p1/proposal/push-to-plan", () => {
      sent.push({ method: "POST", path: "push-to-plan", body: null });
      return HttpResponse.json({ created_tasks: 2 }, { status: 201 });
    }),
  );
  return sent;
}

describe("вкладка предложения", () => {
  beforeEach(() => {
    projectFixtures();
  });

  it("показывает строки сметы и считает итоги: сумму, налог и всего", async () => {
    proposalFixtures();
    renderProject(undefined, { route: "/projects/p1/proposal" });

    // Строка таблицы: роль, цена как effort × rate. У «Гайдлайна» цена 600
    // не совпадает ни с одной ставкой — совпавшая строка прятала бы ошибку.
    expect(await screen.findByRole("button", { name: /Логотип/ })).toBeInTheDocument();
    expect(screen.getByText("Дизайнер")).toBeInTheDocument();
    expect(screen.getByText(money(600))).toBeInTheDocument();

    const summary = screen.getByRole("region", { name: "Итоги предложения" });
    expect(within(summary).getByText("5")).toBeInTheDocument();
    expect(within(summary).getByText(money(800))).toBeInTheDocument();
    expect(within(summary).getByText("Налог (10%)")).toBeInTheDocument();
    expect(within(summary).getByText(money(80))).toBeInTheDocument();
    expect(within(summary).getByText(money(880))).toBeInTheDocument();
  });

  it("щелчок по строке открывает карточку с подробностями и обсуждением", async () => {
    proposalFixtures();
    renderProject(undefined, { route: "/projects/p1/proposal" });

    await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
    const panel = await screen.findByRole("complementary", { name: /Логотип/ });

    // Разделы карточки: подробное описание, заметки, риски, допущения.
    expect(within(panel).getByLabelText("Подробное описание")).toHaveValue("Три варианта");
    expect(within(panel).getByLabelText("Заметки")).toHaveValue("Шрифт покупает клиент");
    expect(within(panel).getByLabelText("Риски")).toHaveValue("Правки затянутся");
    expect(within(panel).getByLabelText("Допущения")).toHaveValue("Брендбук уже есть");
    // Разговор о строке — той же лентой, что у задач.
    expect(await within(panel).findByText("Ставку согласовали")).toBeInTheDocument();
  });

  it("правка поля в карточке уходит на сервер при потере фокуса", async () => {
    const sent = proposalFixtures();
    renderProject(undefined, { route: "/projects/p1/proposal" });

    await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
    const panel = await screen.findByRole("complementary", { name: /Логотип/ });

    const risks = within(panel).getByLabelText("Риски");
    await userEvent.clear(risks);
    await userEvent.type(risks, "Смена подрядчика");
    await userEvent.tab();

    await waitFor(() =>
      expect(sent).toContainEqual({
        method: "PATCH",
        path: "task:pt1",
        body: { risks: "Смена подрядчика" },
      }),
    );
  });

  it("новая строка и новый раздел отправляются со своими именами", async () => {
    const sent = proposalFixtures();
    renderProject(undefined, { route: "/projects/p1/proposal" });
    await screen.findByRole("button", { name: /Логотип/ });

    await userEvent.type(screen.getByLabelText("Название новой задачи"), "Вёрстка");
    await userEvent.click(screen.getByRole("button", { name: "Добавить задачу" }));
    await waitFor(() =>
      expect(sent).toContainEqual({
        method: "POST",
        path: "tasks:pc1",
        body: { name: "Вёрстка" },
      }),
    );

    await userEvent.type(screen.getByLabelText("Название раздела"), "Разработка");
    await userEvent.click(screen.getByRole("button", { name: "Добавить раздел" }));
    await waitFor(() =>
      expect(sent).toContainEqual({
        method: "POST",
        path: "categories",
        body: { name: "Разработка" },
      }),
    );
  });

  it("кнопка переноса отдаёт смету в план", async () => {
    const sent = proposalFixtures();
    renderProject(undefined, { route: "/projects/p1/proposal" });
    await screen.findByRole("button", { name: /Логотип/ });

    await userEvent.click(screen.getByRole("button", { name: "Добавить в план" }));

    await waitFor(() =>
      expect(sent).toContainEqual({ method: "POST", path: "push-to-plan", body: null }),
    );
  });

  it("читателю смета видна, а правка — нет", async () => {
    proposalFixtures();
    renderProject(undefined, { canWrite: false, route: "/projects/p1/proposal" });

    expect(await screen.findByRole("button", { name: /Логотип/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Добавить в план" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Название новой задачи")).not.toBeInTheDocument();
    // Настройки сметы показываются, но выключены: право читать не даёт права
    // менять налог.
    expect(screen.getByLabelText("Налог, %")).toBeDisabled();
  });
});
