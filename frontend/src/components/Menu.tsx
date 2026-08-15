import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useEscape } from "./useEscape";

/**
 * Кнопка с выпадающей панелью — «Фильтр», «Вид», «⋯» в шапке.
 *
 * Панель, а не `role="menu"`: внутри живут не только пункты-действия, но и
 * флажки со списками, а меню по ARIA обязывает каждого потомка быть
 * `menuitem` и ходить по ним стрелками. Обещать эту семантику и не выполнить
 * хуже, чем честная кнопка, раскрывающая область с обычными органами
 * управления, — поэтому здесь `aria-expanded` и `aria-controls`, и всё.
 *
 * Закрывается тремя путями: Esc, щелчок мимо и повторный щелчок по кнопке.
 * Выбор внутри панель не закрывает — в фильтре отмечают несколько флажков
 * подряд, и панель, захлопывающаяся после первого, заставляла бы открывать
 * себя заново на каждый.
 */
export function Menu({
  label,
  children,
  buttonClass = "button--quiet",
  showCaret = true,
  active = false,
  buttonLabel,
}: {
  label: ReactNode;
  children: ReactNode;
  buttonClass?: string;
  /** Стрелка-подсказка «раскроется вниз». «⋯» она не нужна. */
  showCaret?: boolean;
  /** Точка на кнопке: внутри выбран не-пустой фильтр. */
  active?: boolean;
  /** Имя для чтения с экрана, когда видимая подпись — знак вроде «⋯». */
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();

  // Раскрытая панель — верхний слой: её открыли последней, и Esc обязан снять
  // сначала её, а не карточку или окно, над которыми она висит.
  useEscape(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: globalThis.PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <span className="menu" ref={root}>
      <button
        type="button"
        className={`${buttonClass} menu__button${active ? " is-active" : ""}`}
        aria-expanded={open}
        aria-controls={id}
        aria-label={buttonLabel}
        title={buttonLabel}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
        {showCaret && (
          <span className="menu__caret" aria-hidden="true">
            ▾
          </span>
        )}
        {active && <span className="menu__dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="menu__pop" id={id}>
          {children}
        </div>
      )}
    </span>
  );
}
