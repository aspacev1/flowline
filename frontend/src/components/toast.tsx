import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Тост внизу экрана: «Задача перенесена на 19 авг · Отменить».
 *
 * Один, а не очередь: перетаскивания идут подряд, и стопка из пяти «задача
 * перенесена» не сообщает ничего сверх последнего. Новый тост сменяет прежний,
 * заново появляется и заново заводит таймер.
 *
 * `role="status"`, а не `alert`: это подтверждение уже сделанного, а не
 * тревога, и перебивать им чтение с экрана не за что.
 */

type Toast = {
  message: string;
  /** Подпись действия. Без неё тост — только подтверждение. */
  actionLabel?: string;
  onAction?: () => void;
};

const ToastContext = createContext<(toast: Toast) => void>(() => {});

/** Сколько тост висит. Достаточно, чтобы прочитать и успеть нажать «Отменить». */
const TOAST_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(Toast & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Номер тоста. Нужен ровно затем, чтобы стать ключом: без него смена тоста
  // на тот же узел не считается появлением, узел остаётся прежним, и второе
  // «задача перенесена» подряд возникло бы срезом — тем самым, от которого
  // избавлено первое.
  const count = useRef(0);

  const show = useCallback((next: Toast) => {
    if (timer.current !== null) clearTimeout(timer.current);
    count.current += 1;
    setToast({ ...next, id: count.current });
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
        <div className="toast" role="status" key={toast.id}>
          <span className="toast__check" aria-hidden="true">
            ✓
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
