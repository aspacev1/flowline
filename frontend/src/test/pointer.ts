import { fireEvent } from "@testing-library/react";

import { DAY_WIDTH } from "../gantt/scale";

/**
 * Жесты указателем.
 *
 * Событий именно четыре, и последнее — не формальность: после отпускания
 * кнопки браузер сам посылает клик по тому же элементу. Помощник, который его
 * не шлёт, не воспроизводит браузер, и написанное на нём перетаскивание в бою
 * заканчивалось бы открытием карточки.
 */
export function drag(
  element: HTMLElement,
  { fromX, toX, fromY = 0, toY = 0 }: { fromX: number; toX: number; fromY?: number; toY?: number },
) {
  fireEvent.pointerDown(element, { pointerId: 1, button: 0, clientX: fromX, clientY: fromY });
  fireEvent.pointerMove(element, { pointerId: 1, clientX: toX, clientY: toY });
  fireEvent.pointerUp(element, { pointerId: 1, clientX: toX, clientY: toY });
  fireEvent.click(element, { clientX: toX, clientY: toY });
}

/**
 * Перетаскивание полоски на целое число дней.
 *
 * Дни, а не пиксели: ширина дня — это масштаб изображения, и тест, знающий её
 * числом, ломается от смены масштаба по умолчанию, хотя проверяет не масштаб,
 * а перенос задачи.
 */
export function dragDays(element: HTMLElement, days: number, fromX = 100) {
  drag(element, { fromX, toX: fromX + days * DAY_WIDTH.day });
}
