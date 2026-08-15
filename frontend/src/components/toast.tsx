import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Тост внизу экрана: «Задача перенесена на 19 авг · Отменить».
 *
 * Один, а не очередь: перетаскивания идут подряд, и стопка из пяти «задача
 * перенесена» не сообщает ничего сверх последнего. Новый тост сменяет прежний
 * и заново заводит таймер.
 *
 * `role="status"`, а не `alert`: это подтверждение уже сделанного, а не
 * тревога, и перебивать им чтение с экрана не за что. Исключение — отказ
 * (`tone: "error"`): его как раз стоит объявить сразу.
 *
 * Показывать тост обязаны все, кто меняет данные молча: удаление проекта,
 * отзыв приглашения, сохранение поля по уходу фокуса. Иначе получается
 * несогласованность, которая читается как поломка, — перенёс полоску и увидел
 * подтверждение, удалил проект и не увидел ничего.
 */

type Toast = {
  message: string;
  /**
   * Отказ или подтверждение. Различие не косметическое: галочка рядом с
   * «задача не найдена» сообщает ровно обратное тому, что случилось, — а тост
   * показывает и отказы тоже, когда рядом нет места для строки ошибки.
   */
  tone?: "done" | "error";
  /** Подпись действия. Без неё тост — только подтверждение. */
  actionLabel?: string;
  onAction?: () => void;
};

const ToastContext = createContext<(toast: Toast) => void>(() => {});

/** Сколько тост висит. Достаточно, чтобы прочитать и успеть нажать «Отменить». */
const TOAST_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: Toast) => {
    if (timer.current !== null) clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        // `alert` для отказа, `status` для подтверждения: отказ стоит того,
        // чтобы прервать чтение с экрана, а «сохранено» — нет.
        <div
          className={toast.tone === "error" ? "toast toast--error" : "toast"}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <span className="toast__check" aria-hidden="true">
            {toast.tone === "error" ? "!" : "✓"}
          </span>
          <span className="toast__message">{toast.message}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                // Сначала спрятать, потом действовать: отмена сама покажет
                // результат на ленте, а висящий тост предлагал бы отменить то,
                // что уже отменено.
                setToast(null);
                toast.onAction?.();
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
