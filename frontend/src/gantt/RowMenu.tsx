import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useEscape } from "../components/useEscape";

/**
 * Единое место для вторичных действий строки — кнопка «⋯» и панель под ней.
 *
 * До неё у строки задачи было четыре независимых знака, всплывающих по
 * наведению: комментарий, исполнители, «плюс» на границе строк и сама ручка
 * перестановки. Каждый отъедал своё место у имени, и длинное название
 * обрезалось тем раньше, чем больше знаков решало показаться разом. Здесь —
 * одна кнопка постоянной ширины и одна панель, куда вторичные действия
 * переехали целиком; строка от того, что панель открыта, не меняется ни
 * шириной, ни высотой — панель стоит поверх всего по координатам окна, а не
 * внутри строки (тот же приём, что у AssignMenu и карточки наведения).
 */

const PANEL_WIDTH = 232;
// Не измеряется — оценивается заранее, тем же приёмом, что и высота панели
// исполнителей (см. AssignMenu.PANEL_HEIGHT). Панель ограничена `max-height` в
// стилях, и вложенные виды (роспись по исполнителям, список категорий)
// раскрываются в те же рамки — оценка остаётся верной для любого из них.
const PANEL_ESTIMATED_HEIGHT = 300;
/** Просвет между кнопкой и панелью — и минимальный отступ от края окна. */
const GAP = 6;

type Point = { left: number; top: number };

/**
 * Место панели: по умолчанию вниз-вправо от кнопки, как раскрывающееся меню.
 * Разворот в обе стороны — единственная причина, по которой это не копия
 * `placeBelow` из AssignMenu: там нет строк длиннее панели, которым тесно
 * справа, а здесь есть — список категорий у пункта «Переместить».
 */
function place(rect: DOMRect): Point {
  const spaceRight = window.innerWidth - rect.left;
  const left =
    spaceRight >= PANEL_WIDTH + GAP
      ? rect.left
      : Math.max(GAP, rect.right - PANEL_WIDTH);
  const clampedLeft = Math.max(GAP, Math.min(left, window.innerWidth - PANEL_WIDTH - GAP));

  const spaceBelow = window.innerHeight - rect.bottom;
  const top =
    spaceBelow >= PANEL_ESTIMATED_HEIGHT + GAP
      ? rect.bottom + GAP
      : Math.max(GAP, rect.top - GAP - PANEL_ESTIMATED_HEIGHT);

  return { left: clampedLeft, top };
}

export function RowMenu({
  label,
  children,
  onClose,
  describedBy,
  testId,
}: {
  /** Имя кнопки для чтения с экрана — общее на все строки, см. `describedBy`. */
  label: string;
  /** Содержимое панели. Функция получает `close`, чтобы закрыть меню после выбора. */
  children: (close: () => void) => ReactNode;
  /**
   * Меню закрылось — любым путём: Esc, щелчок мимо, выбор пункта. Строка,
   * умеющая нырять во вложенный вид (роспись по исполнителям, список
   * категорий), возвращает себя в корень здесь же — иначе меню, открытое
   * заново, помнило бы, на каком виде его застали в прошлый раз.
   */
  onClose?: () => void;
  /**
   * Узел с именем строки — так же, как у кнопки исполнителей (см. AssignMenu):
   * подпись кнопки одна и та же на всех задачах («Действия с задачей») или
   * всех категориях («Действия с категорией»), а какой из них принадлежит эта
   * кнопка, говорит описание. Имя строки нарочно не входит в подпись: будь оно
   * там, кнопка совпадала бы с полоской задачи в любом поиске по этому имени —
   * обе тогда читались бы как «кнопка «Логотип»».
   */
  describedBy?: string;
  testId?: string;
}) {
  const [at, setAt] = useState<Point | null>(null);
  const open = at !== null;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = () => {
    setAt(null);
    onCloseRef.current?.();
  };

  useEscape(close, open);

  useEffect(() => {
    if (!open) return;
    // Локальная копия, а не внешний `close`: эффект перезаводится только по
    // `open`, и внешняя версия (новая ссылка на каждый рендер) заставляла бы
    // его следовать за всяким чужим обновлением строки.
    const dismiss = () => {
      setAt(null);
      onCloseRef.current?.();
    };
    function onPointerDown(event: globalThis.PointerEvent) {
      const target = event.target as Node;
      const inside =
        button.current?.contains(target) === true || panel.current?.contains(target) === true;
      if (!inside) dismiss();
    }
    document.addEventListener("pointerdown", onPointerDown);
    // Захват, а не всплытие — по той же причине, что и у панели исполнителей:
    // прокручивается лента, а не окно, и её событие до окна иначе не доходит.
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  return (
    <span className="gantt__row-actions">
      <button
        ref={button}
        type="button"
        className={`gantt__more${open ? " is-active" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        aria-describedby={describedBy}
        title={label}
        data-testid={testId ? `${testId}-button` : undefined}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          const rect = button.current?.getBoundingClientRect();
          if (rect) setAt(place(rect));
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={panel}
            className="gantt__more-pop"
            style={{ left: at.left, top: at.top, width: PANEL_WIDTH }}
            role="group"
            aria-label={label}
            aria-describedby={describedBy}
            data-testid={testId}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** Обычный пункт меню: знак и подпись, действие по щелчку. */
export function MenuAction({
  icon,
  tone = "quiet",
  disabled = false,
  /** Отмеченный пункт — например, уже назначенный исполнитель в росписи. */
  pressed,
  onClick,
  children,
}: {
  icon?: ReactNode;
  /** «danger» — необратимое действие: цвет называет его раньше подписи. */
  tone?: "quiet" | "danger";
  disabled?: boolean;
  /** `undefined` — пункт не переключаемый, и `aria-pressed` ему не за чем. */
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`gantt__more-item${tone === "danger" ? " gantt__more-item--danger" : ""}${
        pressed ? " is-pressed" : ""
      }`}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon && (
        <span className="gantt__more-item-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="gantt__more-item-label">{children}</span>
    </button>
  );
}

/** Черта между смысловыми группами пунктов. */
export function MenuSeparator() {
  return <span className="gantt__more-sep" role="separator" aria-hidden="true" />;
}

/** Заголовок вложенного вида: имя вида и возврат к списку действий. */
export function MenuBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="gantt__more-back" onClick={onClick}>
      <span aria-hidden="true">←</span>
      {label}
    </button>
  );
}
