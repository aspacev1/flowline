import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { WITH_DEPENDENCY, projectFixtures, renderProject } from "../test/project";

beforeEach(projectFixtures);

/** Левый край и ширина полоски — так, как их поставила шкала. */
function barBox(name: string): { left: number; width: number } {
  const bar = screen.getByRole("button", { name: new RegExp(name) });
  return { left: Number.parseFloat(bar.style.left), width: Number.parseFloat(bar.style.width) };
}

function pointsOf(container: HTMLElement): number[][] {
  const polyline = container.querySelector("svg.arrows polyline");
  if (!polyline) throw new Error("стрелки нет");
  return polyline
    .getAttribute("points")!
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number));
}

describe("стрелки связей", () => {
  it("рисует стрелку между связанными задачами", async () => {
    const { container } = renderProject(WITH_DEPENDENCY);
    await screen.findByRole("button", { name: /Логотип/ });

    expect(container.querySelectorAll("svg.arrows polyline")).toHaveLength(1);
  });

  it("держит стрелку на концах полосок, когда открывается карточка", async () => {
    // План требовал здесь другого: чтобы точки после открытия карточки
    // изменились. Изменяться им нечего — стрелки живут в системе координат
    // ленты, а не окна, и открытие карточки сужает окно, но не двигает
    // полоски. Проверять надо не движение точек, а то, ради чего оно затевалось
    // бы: что стрелка по-прежнему упирается в концы полосок. Этот тест поймает
    // и уехавшую стрелку, и стрелку, забывшую пересчитаться.
    const { container } = renderProject(WITH_DEPENDENCY);
    await screen.findByRole("button", { name: /Логотип/ });

    await userEvent.click(screen.getByRole("button", { name: /Логотип/ }));
    expect(screen.getByRole("complementary")).toBeInTheDocument();

    const from = barBox("Логотип");
    const to = barBox("Макет");
    const points = pointsOf(container);

    expect(points[0][0]).toBe(from.left + from.width);
    expect(points.at(-1)![0]).toBe(to.left);
  });

  it("подсвечивает нарушенную связь, когда приёмник начат до готовности источника", async () => {
    // Конец отрезка включительный: старт в последний день источника — уже
    // нахлёст, и такую стрелку лента красит цветом тревоги.
    const { container } = renderProject({
      ...WITH_DEPENDENCY,
      tasks: [
        WITH_DEPENDENCY.tasks[0],
        { ...WITH_DEPENDENCY.tasks[1], start_date: "2026-03-10" },
      ],
    });
    await screen.findByRole("button", { name: /Логотип/ });

    expect(container.querySelector("svg.arrows polyline")).toHaveClass("is-violated");
  });

  it("не подсвечивает связь, когда приёмник начинается после источника", async () => {
    const { container } = renderProject(WITH_DEPENDENCY);
    await screen.findByRole("button", { name: /Логотип/ });

    expect(container.querySelector("svg.arrows polyline")).not.toHaveClass("is-violated");
  });

  it("не рисует стрелку в задачу, которой нет в проекте", async () => {
    // Связь переживает задачу ровно на один ответ сервера: её удалили в
    // соседней вкладке. Рисовать стрелку в пустоту нельзя — она уходит в
    // NaN и уносит с собой весь слой.
    const { container } = renderProject({
      ...WITH_DEPENDENCY,
      dependencies: [{ from_task_id: "t1", to_task_id: "t404" }],
    });
    await screen.findByRole("button", { name: /Логотип/ });

    expect(container.querySelectorAll("svg.arrows polyline")).toHaveLength(0);
  });
});
