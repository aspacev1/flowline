import { fireEvent } from "@testing-library/react";

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
