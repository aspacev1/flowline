import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { server } from "../test/server";
import { THREE_TASKS, projectFixtures, renderProject } from "../test/project";

beforeEach(projectFixtures);

describe("вкладки карточки задачи", () => {
  it("открывается на «Свойствах»; «История» и «Комментарии» — по вкладке", async () => {
    server.use(
      http.get("/api/projects/p1/revisions", () =>
        HttpResponse.json([
          {
            seq: 1,
            created_at: "2026-08-13T10:00:00Z",
            actor: { id: "u2", name: "Мария" },
            reason: null,
            batch_id: null,
            undoes_seq: null,
            op: { type: "set_progress", task_id: "t1", from: 30, to: 40 },
            names: {},
          },
        ]),
      ),
    );

    renderProject();
    await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
    const panel = screen.getByRole("complementary");

    // По умолчанию — свойства задачи, поля видны сразу.
    expect(within(panel).getByLabelText("Название")).toBeInTheDocument();
    expect(within(panel).queryByRole("region", { name: "Комментарии" })).not.toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("tab", { name: "История" }));
    // Автор и фраза события — соседние узлы одной строки: имя оформлено
    // отдельным `span`, и цельная строка не собирается в один текстовый узел.
    expect(await within(panel).findByText(/изменил готовность с 30% на 40%/)).toBeInTheDocument();
    expect(within(panel).getByText("Мария")).toBeInTheDocument();
    // Свойства ушли с глаз, пока открыта другая вкладка.
    expect(within(panel).queryByLabelText("Название")).not.toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("tab", { name: "Комментарии" }));
    expect(within(panel).getByRole("region", { name: "Комментарии" })).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("tab", { name: "Свойства" }));
    expect(within(panel).getByLabelText("Название")).toBeInTheDocument();
  });

  it("переход к другой задаче возвращает карточку на «Свойства»", async () => {
    renderProject(THREE_TASKS);
    await userEvent.click(await screen.findByRole("button", { name: /Первая/ }));
    const panel = screen.getByRole("complementary");

    await userEvent.click(within(panel).getByRole("tab", { name: "История" }));
    expect(within(panel).getByRole("tab", { name: "История" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Открыли соседнюю задачу, не закрывая карточку — прежняя вкладка не
    // должна молча остаться открытой на чужой истории.
    await userEvent.click(screen.getByRole("button", { name: /Вторая/ }));

    await waitFor(() =>
      expect(within(panel).getByRole("tab", { name: "Свойства" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(within(panel).getByLabelText("Название")).toHaveValue("Вторая");
  });

  it("удаление задачи доступно с любой вкладки", async () => {
    renderProject();
    await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
    const panel = screen.getByRole("complementary");

    await userEvent.click(within(panel).getByRole("tab", { name: "Комментарии" }));
    expect(within(panel).getByRole("button", { name: "Удалить задачу" })).toBeInTheDocument();
  });
});
