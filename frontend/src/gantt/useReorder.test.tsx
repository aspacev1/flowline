import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { drag } from "../test/pointer";
import {
  THREE_TASKS,
  TWO_CATEGORIES,
  captureMutations,
  projectFixtures,
  renderProject,
} from "../test/project";

beforeEach(projectFixtures);

/**
 * Строка по названию в левой колонке — не по тексту полоски: название стоит и
 * там, и там, и поиск по тексту находил бы две штуки.
 */
function rowOf(name: string): HTMLElement {
  const labels = Array.from(document.querySelectorAll<HTMLElement>(".gantt__label-name"));
  const label = labels.find((node) => node.textContent === name);
  if (!label) throw new Error(`строка «${name}» не найдена`);
  return label.closest(".gantt__row") as HTMLElement;
}

function rowHandle(name: string): HTMLElement | null {
  return rowOf(name).querySelector(".gantt__handle");
}

/**
 * Высота строки, которой у jsdom нет.
 *
 * Половина строки решает, встанет ли задача над соседом или под ним, и
 * считается она от настоящих границ. Без подстановки все границы нулевые, и
 * верхней половины не существует вовсе.
 */
function withHeight(row: HTMLElement): HTMLElement {
  row.getBoundingClientRect = () =>
    ({ top: 0, bottom: 32, height: 32, left: 0, right: 500, width: 500, x: 0, y: 0 }) as DOMRect;
  return row;
}

function hoverRowWhileDragging(
  name: string,
  { over, half, isCategory }: { over: string; half?: "top" | "bottom"; isCategory?: boolean },
): HTMLElement {
  fireEvent.pointerDown(rowHandle(name)!, { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
  const target = isCategory ? rowOf(over) : withHeight(rowOf(over));
  fireEvent.pointerMove(target, { pointerId: 2, clientX: 10, clientY: half === "top" ? 8 : 24 });
  return target;
}

function dragRow(
  name: string,
  options: { over: string; half?: "top" | "bottom"; isCategory?: boolean },
) {
  const target = hoverRowWhileDragging(name, options);
  fireEvent.pointerUp(target, { pointerId: 2, clientX: 10, clientY: 24 });
}

/**
 * Тот же жест пальцем.
 *
 * Разница не в названии события, а в том, кому оно приходит: указатель после
 * нажатия захвачен ручкой, и движение с отпусканием достаются ей одной —
 * строка под пальцем не получает ничего. Поэтому здесь всё шлётся на ручку, а
 * строку выдаёт попадание в точку, которого у jsdom нет и которое
 * подставляется на время теста.
 */
function touchDragRow(
  name: string,
  { over, half, isCategory }: { over: string; half?: "top" | "bottom"; isCategory?: boolean },
) {
  const handle = rowHandle(name)!;
  const target = isCategory ? rowOf(over) : withHeight(rowOf(over));
  document.elementFromPoint = () => target;
  const at = { pointerId: 3, clientX: 10, clientY: half === "top" ? 8 : 24 };
  fireEvent.pointerDown(handle, { ...at, button: 0 });
  fireEvent.pointerMove(handle, at);
  return { handle, at, target };
}

afterEach(() => {
  // Подстановка попаданий — на один тест: она стоит на документе и утекла бы в
  // соседние, где строки под точкой быть не должно.
  Reflect.deleteProperty(document, "elementFromPoint");
});

describe("перестановка строк", () => {
  it("перетаскивание за левую колонку меняет порядок, а не даты", async () => {
    const sent = captureMutations();
    renderProject(THREE_TASKS);
    await screen.findByRole("button", { name: /Третья/ });

    dragRow("Третья", { over: "Первая", half: "top" });

    await waitFor(() => expect(sent[0].op).toMatchObject({ type: "reorder_task", position: 0 }));
    expect(sent[0].op).not.toHaveProperty("start_date");
  });

  it("бросок на заголовок категории переносит задачу в неё", async () => {
    const sent = captureMutations();
    renderProject(TWO_CATEGORIES);
    await screen.findByRole("button", { name: /Логотип/ });

    dragRow("Логотип", { over: "Разработка", isCategory: true });

    await waitFor(() =>
      expect(sent[0].op).toMatchObject({ type: "reorder_task", category_id: "c2" }),
    );
  });

  it("показывает линию вставки сверху или снизу в зависимости от курсора", async () => {
    renderProject(THREE_TASKS);
    await screen.findByRole("button", { name: /Третья/ });

    hoverRowWhileDragging("Третья", { over: "Первая", half: "top" });
    expect(rowOf("Первая")).toHaveClass("drop-before");

    hoverRowWhileDragging("Третья", { over: "Первая", half: "bottom" });
    expect(rowOf("Первая")).toHaveClass("drop-after");
  });

  it("пальцем строка переставляется так же, как мышью", async () => {
    const sent = captureMutations();
    renderProject(THREE_TASKS);
    await screen.findByRole("button", { name: /Третья/ });

    const { handle, at } = touchDragRow("Третья", { over: "Первая", half: "top" });
    expect(rowOf("Первая")).toHaveClass("drop-before");
    fireEvent.pointerUp(handle, at);

    await waitFor(() => expect(sent[0].op).toMatchObject({ type: "reorder_task", position: 0 }));
  });

  it("пальцем задача переносится в другую категорию", async () => {
    const sent = captureMutations();
    renderProject(TWO_CATEGORIES);
    await screen.findByRole("button", { name: /Логотип/ });

    const { handle, at } = touchDragRow("Логотип", { over: "Разработка", isCategory: true });
    fireEvent.pointerUp(handle, at);

    await waitFor(() =>
      expect(sent[0].op).toMatchObject({ type: "reorder_task", category_id: "c2" }),
    );
  });

  it("палец мимо строк гасит линию вставки, и бросок ничего не делает", async () => {
    const sent = captureMutations();
    renderProject(THREE_TASKS);
    await screen.findByRole("button", { name: /Третья/ });

    const { handle, at } = touchDragRow("Третья", { over: "Первая", half: "top" });
    // Палец ушёл за строки — над шапкой ленты цели броска нет.
    document.elementFromPoint = () => null;
    fireEvent.pointerMove(handle, at);
    expect(rowOf("Первая")).not.toHaveClass("drop-before");

    fireEvent.pointerUp(handle, at);
    expect(sent).toHaveLength(0);
  });

  it("перетаскивание полоски не меняет порядок", async () => {
    const sent = captureMutations();
    renderProject(THREE_TASKS);

    drag(await screen.findByRole("button", { name: /Третья/ }), { fromX: 100, toX: 152 });

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].op.type).toBe("move_task");
  });

  it("в гостевом режиме строки не перетаскиваются", async () => {
    renderProject(THREE_TASKS, { canWrite: false });
    await screen.findByRole("button", { name: /Первая/ });

    expect(rowHandle("Первая")).not.toBeInTheDocument();
  });
});
