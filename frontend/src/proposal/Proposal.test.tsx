import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { ProposalState } from "../api/proposal";
import { projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";

/**
 * Смета с двумя строками: 2д × 100 и 3д × 200 — сумма 800, налог 10% — 80,
 * итого 880, объём 5 дней и 40 часов (по восьмичасовому дню). Числа выбраны
 * так, чтобы каждая строка итогов отличалась от любой другой: совпадение
 * двух сумм позволило бы тесту зеленеть на перепутанных строках.
 */
const PROPOSAL: ProposalState = {
  effort_unit: "days",
  hours_per_day: 8,
  tax_rate_pct: 10,
  currency: "USD",
  notes: "Оценки по текущему объёму.\nСтавки без стоимости лицензий.",
  categories: [
    {
      id: "pc1",
      name: "Дизайн",
      description: "Понять и нарисовать",
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
    http.post(
      "/api/projects/p1/proposal/categories/:categoryId/tasks",
      async ({ request, params }) => {
        sent.push({
          method: "POST",
          path: `tasks:${params.categoryId as string}`,
          body: await request.json(),
        });
        return HttpResponse.json(
          { id: "pt-new", category_id: params.categoryId, name: "Новая" },
          { status: 201 },
        );
      },
    ),
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
    http.patch("/api/projects/p1/proposal", async ({ request }) => {
      sent.push({ method: "PATCH", path: "proposal", body: await request.json() });
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

  it("показывает работы по разделам и считает итоги: объём, сумму, налог, всего", async () => {
    proposalFixtures();
    renderProject(undefined, { route: "/projects/p1/proposal" });

    // Строка работы: роль в карточке, а в таблице — оценка в днях и часах,
    // ставка за день и цена. У «Гайдлайна» цена 600 не совпадает ни с одной
    // ставкой — совпавшая строка прятала бы ошибку.
    expect(await screen.findByRole("button", { name: /Логотип/ })).toBeInTheDocument();
    expect(screen.getByText("Знак")).toBeInTheDocument();
    expect(screen.getByText("2д")).toBeInTheDocument();
    expect(screen.getByText("16ч")).toBeInTheDocument();
    expect(screen.getByText(`${money(100)}/д`)).toBeInTheDocument();
    expect(screen.getByText(money(600))).toBeInTheDocument();

    // Строка раздела — сводка своих работ и описание.
    expect(screen.getByDisplayValue("Понять и нарисовать")).toBeInTheDocument();

    const summary = screen.getByRole("complementary", { name: "Итоги предложения" });
    expect(within(summary).getByText("40ч")).toBeInTheDocument();
    expect(within(summary).getByText("5д")).toBeInTheDocument();
    expect(within(summary).getByText(money(800))).toBeInTheDocument();
    expect(within(summary).getByText("Налог (10%)")).toBeInTheDocument();
    expect(within(summary).getByText(money(80))).toBeInTheDocument();
    expect(within(summary).getByText(money(880))).toBeInTheDocument();
  });

  it("шеврон сворачивает раздел: работы прячутся, сводка остаётся", async () => {
    proposalFixtures();
    renderProject(undefined, { route: "/projects/p1/proposal" });
    await screen.findByRole("button", { name: /Логотип/ });

    await userEvent.click(
      screen.getByRole("button", { name: "Свернуть раздел «Дизайн»" }),
    );

    expect(screen.queryByRole("button", { name: /Логотип/ })).not.toBeInTheDocument();
    // Сводка раздела на месте: свёрнутый раздел — строка с суммой, не дыра.
    expect(screen.getByText("Дизайн")).toBeInTheDocument();
    expect(screen.getAllByText(money(800)).length).toBeGreaterThan(0);
  });

  it("щелчок по работе открывает карточку с подробностями и обсуждением", async () => {
    proposalFixtures();
    renderProject(undefined, { route: "/projects/p1/proposal" });

    await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
    const panel = await screen.findByRole("complementary", { name: /Логотип/ });

    expect(within(panel).getByLabelText("Подробное описание")).toHaveValue("Три варианта");
    expect(within(panel).getByLabelText("Заметки")).toHaveValue("Шрифт покупает клиент");
    expect(within(panel).getByLabelText("Риски")).toHaveValue("Правки затянутся");
    expect(within(panel).getByLabelText("Допущения")).toHaveValue("Брендбук уже есть");
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

  it("работа заводится строкой в таблице: Enter отправляет и оставляет поле", async () => {
    const sent = proposalFixtures();
    renderProject(undefined, { route: "/projects/p1/proposal" });
    await screen.findByRole("button", { name: /Логотип/ });

    // Кнопка тулбара открывает строку в первом разделе — как в ленте.
    await userEvent.click(screen.getByRole("button", { name: "Новая работа" }));
    const input = screen.getByLabelText("Новая работа в «Дизайн»");
    await userEvent.type(input, "Вёрстка{Enter}");

    await waitFor(() =>
      expect(sent).toContainEqual({
        method: "POST",
        path: "tasks:pc1",
        body: { name: "Вёрстка" },
      }),
    );
    // Enter не закрывает строку: следующую работу пишут сразу.
    expect(screen.getByLabelText("Новая работа в «Дизайн»")).toHaveValue("");

    // «Плюс» на строке раздела открывает ту же строку в этом разделе.
    await userEvent.click(screen.getByRole("button", { name: "Добавить работу в «Дизайн»" }));
    expect(screen.getByLabelText("Новая работа в «Дизайн»")).toBeInTheDocument();
  });

  it("раздел заводится окном из тулбара — как категория в ленте", async () => {
    const sent = proposalFixtures();
    renderProject(undefined, { route: "/projects/p1/proposal" });
    await screen.findByRole("button", { name: /Логотип/ });

    await userEvent.click(screen.getByRole("button", { name: "Новый раздел" }));
    const modal = await screen.findByRole("dialog");
    await userEvent.type(within(modal).getByLabelText("Название"), "Разработка");
    await userEvent.type(within(modal).getByLabelText("Описание"), "Собрать приложение");
    await userEvent.click(within(modal).getByRole("button", { name: "Создать" }));

    await waitFor(() =>
      expect(sent).toContainEqual({
        method: "POST",
        path: "categories",
        body: { name: "Разработка", description: "Собрать приложение" },
      }),
    );
  });

  it("примечания предложения показываются пунктами и правятся на месте", async () => {
    const sent = proposalFixtures();
    renderProject(undefined, { route: "/projects/p1/proposal" });
    await screen.findByRole("button", { name: /Логотип/ });

    // Пункт на строку — списком.
    expect(screen.getByText("Оценки по текущему объёму.")).toBeInTheDocument();
    expect(screen.getByText("Ставки без стоимости лицензий.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Править примечания" }));
    // Роль сужает поиск: той же подписью подписана и сама карточка примечаний.
    const editor = screen.getByRole("textbox", { name: "Допущения и примечания" });
    await userEvent.clear(editor);
    await userEvent.type(editor, "Смета действительна месяц.");
    await userEvent.tab();

    await waitFor(() =>
      expect(sent).toContainEqual({
        method: "PATCH",
        path: "proposal",
        body: { notes: "Смета действительна месяц." },
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
    expect(screen.queryByRole("button", { name: "Новая работа" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Новый раздел" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Править примечания" }),
    ).not.toBeInTheDocument();
    // Описание раздела — текстом, не полем: право читать не даёт права менять.
    expect(screen.getByText("Понять и нарисовать")).toBeInTheDocument();
    // Настройки сметы показываются, но выключены.
    expect(screen.getByLabelText("Налог, %")).toBeDisabled();
  });
});
