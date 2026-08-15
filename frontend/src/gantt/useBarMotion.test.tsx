import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { matchMediaMock } from "../test/motion";
import { drag } from "../test/pointer";
import { projectFixtures, renderProject } from "../test/project";
import { MOTION_MS } from "./motion";
import { DAY_WIDTH } from "./scale";

/**
 * Полоска стоит на `left`/`width` и двигается только через `transform`.
 *
 * Проверяется здесь не оформление, а стоимость движения. `left` и `width` —
 * свойства разметки: анимация по ним пересчитывает положение всего слоя строк
 * каждый кадр, и на сотне задач лента от этого дёргается. Тест ловит возврат
 * к ним обратно — правку, которая ничего не сломает на пяти задачах оснастки и
 * проявится только на живом проекте.
 */

/**
 * Кадры, которые полоска попросила у браузера.
 *
 * `Element.animate` в jsdom нет вовсе, поэтому это не подмена настоящего
 * поведения, а единственный способ вообще увидеть просьбу об анимации.
 */
function captureSlides(): { transform: string }[][] {
  const slides: { transform: string }[][] = [];
  const animate = vi.fn((frames: { transform: string }[]) => {
    slides.push(frames);
    return { cancel: () => {} };
  });
  Object.defineProperty(Element.prototype, "animate", {
    value: animate,
    configurable: true,
    writable: true,
  });
  return slides;
}

beforeEach(projectFixtures);
afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
  vi.unstubAllGlobals();
});

describe("движение полоски", () => {
  it("под пальцем сдвигает полоску, не трогая её места по датам", async () => {
    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });
    const placed = bar.style.left;

    fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 100 + 3 * DAY_WIDTH.day });

    // Место по датам не тронуто: его меняет только ответ сервера.
    expect(bar.style.left).toBe(placed);
    expect(bar.style.getPropertyValue("--bar-dx")).toBe(`${3 * DAY_WIDTH.day}px`);
  });

  it("отпущенная полоска доезжает до своего дня, а не прыгает на него", async () => {
    const slides = captureSlides();
    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });

    // Три дня и ещё десять пикселей: день выбирается ближайший, и эти десять
    // пикселей полоске предстоит проехать обратно — из-под пальца на сетку.
    drag(bar, { fromX: 100, toX: 100 + 3 * DAY_WIDTH.day + 10 });

    await waitFor(() => expect(slides.length).toBeGreaterThan(0));
    expect(slides[0]).toEqual([
      { transform: "translate3d(10px, 0, 0)" },
      { transform: "translate3d(0px, 0, 0)" },
    ]);
    // А место по датам к этому моменту уже новое, и сдвига на полоске нет:
    // переезд — это анимация поверх готового места, а не путь к нему.
    expect(bar.style.left).toBe(`${6 * DAY_WIDTH.day}px`);
    expect(bar.style.getPropertyValue("--bar-dx")).toBe("0px");
  });

  it("жест, ничего не изменивший, возвращает полоску на место сам", async () => {
    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });

    // Меньше половины дня — переноса нет, и рендера с новым местом тоже не
    // будет. Снять сдвиг, кроме самого жеста, некому.
    drag(bar, { fromX: 100, toX: 100 + 12 });

    await waitFor(() => expect(bar.style.getPropertyValue("--bar-dx")).toBe("0px"));
  });

  it("смена масштаба не показывает переезда: поехали не задачи, а лента", async () => {
    const slides = captureSlides();
    renderProject();
    await screen.findByRole("button", { name: /Логотип/ });

    await userEvent.click(screen.getByRole("button", { name: "Масштаб: День" }));
    await userEvent.click(screen.getByRole("radio", { name: "Неделя" }));

    // Полоски встали на другие места, потому что день стал уже. Это другое
    // изображение той же ленты, и «переезжающие» разом все полоски читались бы
    // как обвал плана.
    expect(slides).toHaveLength(0);
  });

  it("просьба о меньшем движении отменяет переезд, а не укорачивает его", async () => {
    matchMediaMock("(prefers-reduced-motion: reduce)", true);
    const slides = captureSlides();
    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });

    drag(bar, { fromX: 100, toX: 100 + 3 * DAY_WIDTH.day + 10 });

    // Общее правило `transition: none` из styles.css сюда не достаёт: оно
    // гасит переходы CSS, а переезд заведён из кода.
    await waitFor(() => expect(bar.style.left).toBe(`${6 * DAY_WIDTH.day}px`));
    expect(slides).toHaveLength(0);
  });

  it("переезд идёт ровно столько же, сколько переходы ленты", async () => {
    const slides = captureSlides();
    const { container } = renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });

    drag(bar, { fromX: 100, toX: 100 + 3 * DAY_WIDTH.day + 10 });

    await waitFor(() => expect(slides.length).toBeGreaterThan(0));
    // Одно число на оба: длительность приходит в стили из того же `MOTION_MS`,
    // которым код ведёт переезд, — иначе они разошлись бы при первой правке.
    const animate = Element.prototype.animate as unknown as ReturnType<typeof vi.fn>;
    expect(animate.mock.calls[0][1]).toMatchObject({ duration: MOTION_MS });
    expect(container.querySelector<HTMLElement>(".gantt")?.style.getPropertyValue("--motion")).toBe(
      `${MOTION_MS}ms`,
    );
  });
});
