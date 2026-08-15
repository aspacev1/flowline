import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

import { useEscape } from "./useEscape";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Окно, которое ведёт себя как окно.
 *
 * Закрывается по Esc и по клику мимо, ставит фокус на первое поле при
 * открытии и возвращает его туда, откуда его открыли. Всё это — не украшение:
 * без возврата фокуса человек с клавиатуры после закрытия оказывается в
 * начале страницы, а без Esc у него вовсе нет способа уйти, не найдя мышью
 * крестик.
 *
 * Компонент один на всё приложение сознательно: следующий экран, которому
 * понадобится окно, не должен изобретать эти четыре правила заново и
 * ошибиться в одном из них.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  // Захватывается при монтировании, а не при закрытии: к моменту закрытия
  // фокус давно внутри окна, и спрашивать его уже поздно.
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;

    // Первое поле, а не само окно: человек открыл форму, чтобы её заполнить,
    // и лишнее нажатие Tab здесь — это лишний шаг в каждом создании подряд.
    const focusable = dialog.current?.querySelector<HTMLElement>(
      "input, select, textarea, button",
    );
    focusable?.focus();

    return () => {
      const previous = opener.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  // Esc через общую стопку слоёв, а не своим слушателем на документе: окно
  // почти всегда всплывает поверх чего-то — карточки задачи, меню, другого
  // окна, — и собственный слушатель у каждого закрывал бы одним нажатием всех
  // сразу. Слушатель всё так же на документе, а не на самом окне: Esc обязан
  // работать и тогда, когда фокус ушёл из окна, — иначе правило действует не
  // всегда, а это хуже, чем не действовать вовсе.
  useEscape(onClose);

  return (
    <div
      className="modal__backdrop"
      data-testid="modal-backdrop"
      // Клик именно по подложке, а не по всплывшему из окна: иначе окно
      // закрывалось бы от клика по любому своему полю.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
        <h2 className="modal__title" id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
