import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { drag, dragDays } from "../test/pointer";
import { captureMutations, projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";

beforeEach(projectFixtures);

describe("перетаскивание дат", () => {
  it("двигает полоску с шагом в целый день", async () => {
    const sent = captureMutations();
    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });

    dragDays(bar, 3);

    await waitFor(() =>
      expect(sent[0].op).toMatchObject({ type: "move_task", start_date: "2026-03-07" }),
    );
  });

  it("не отправляет ничего, если полоску вернули на место", async () => {
    const sent = captureMutations();
    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });

    drag(bar, { fromX: 100, toX: 100 + 12 }); // меньше половины дня

    expect(sent).toHaveLength(0);
  });

  it("не открывает карточку по окончании перетаскивания", async () => {
    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });

    dragDays(bar, 2);

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("возвращает полоску на место, если сервер отказал", async () => {
    server.use(
      http.post("/api/projects/p1/mutations", () =>
        HttpResponse.json({ detail: "task_not_found" }, { status: 404 }),
      ),
    );

    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });
    const before = bar.style.left;

    dragDays(bar, 3);

    await waitFor(() => expect(bar.style.left).toBe(before));
  });

  it("клавиатура двигает задачу так же, как мышь", async () => {
    const sent = captureMutations();
    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });

    bar.focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");

    await waitFor(() =>
      expect(sent[0].op).toMatchObject({ type: "move_task", start_date: "2026-03-05" }),
    );
  });

  it("подтверждённый перенос показывает тост с отменой", async () => {
    // Отмена из тоста бьёт в тот же /undo, что и кнопка в шапке: тост — это
    // короткий путь к ней, а не второй механизм отмены.
    let undone = 0;
    server.use(http.post("/api/projects/p1/undo", () => {
      undone += 1;
      return HttpResponse.json({ seq: 1 });
    }));

    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });

    bar.focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Задача перенесена");

    await userEvent.click(screen.getByRole("button", { name: "Отменить" }));
    await waitFor(() => expect(undone).toBe(1));
    // Нажатая отмена прячет тост: предлагать отменить отменённое нечестно.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
