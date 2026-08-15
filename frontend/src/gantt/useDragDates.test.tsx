import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { drag, dragDays } from "../test/pointer";
import { APPROVED, captureMutations, projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";
import { DAY_WIDTH } from "./scale";

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

  it("держит полоску на месте броска, пока спрашивают причину", async () => {
    // Возврат до вопроса читался бы как отказ: человек ещё ничего не решил, а
    // полоска уже съездила обратно — и после ответа поехала бы второй раз.
    const sent = captureMutations();
    renderProject(APPROVED);
    const bar = await screen.findByRole("button", { name: /Логотип/ });
    const before = Number.parseFloat(bar.style.left);

    dragDays(bar, 7);

    await screen.findByRole("dialog");
    expect(sent).toHaveLength(0);
    expect(Number.parseFloat(bar.style.left)).toBe(before + 7 * DAY_WIDTH.day);
  });

  it("возвращает полоску, когда причину объяснять отказались", async () => {
    renderProject(APPROVED);
    const bar = await screen.findByRole("button", { name: /Логотип/ });
    const before = bar.style.left;

    dragDays(bar, 7);
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("button", { name: "Вернуть" }));

    await waitFor(() => expect(bar.style.left).toBe(before));
  });

  it("после введённой причины полоска стоит на новом месте и не ездит дважды", async () => {
    renderProject(APPROVED);
    const bar = await screen.findByRole("button", { name: /Логотип/ });
    const before = Number.parseFloat(bar.style.left);

    dragDays(bar, 7);
    await screen.findByRole("dialog");

    await userEvent.type(screen.getByLabelText("Причина"), "заказчик молчит");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Полоска и до ответа стояла здесь: смена дат её не двигает — она лишь
    // объясняет положение, в котором полоска уже стоит.
    expect(Number.parseFloat(bar.style.left)).toBe(before + 7 * DAY_WIDTH.day);
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
