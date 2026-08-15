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
  /**
   * Действие целиком, узлом. Без него тост — только подтверждение.
   *
   * Узел, а не пара «подпись и обработчик»: действие живёт те шесть секунд,
   * что висит тост, и за это время может умереть — отменять становится нечего
   * или уже не то. Знает об этом тот, кто действие предложил, а не тост; тост
   * же, храня обработчик, показывал бы живую кнопку до последней секунды и
   * узнавал правду только от сервера, уже нажатой.
   */
  action?: ReactNode;
};

const ToastContext = createContext<(toast: Toast) => void>(() => {});
/** Спрятать тост. Нужен действию: нажатое, оно само решает, что показывать дальше. */
const DismissContext = createContext<() => void>(() => {});

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

  const dismiss = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    setToast(null);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      <DismissContext.Provider value={dismiss}>
        {children}
        {toast && (
          // Ключ по тосту: следующее сообщение — новый узел, и появление
          // проигрывается заново, а не подменяет текст в уже висящей плашке.
          <div className="toast" role="status" key={toast.id}>
            <span className="toast__check" aria-hidden="true">
              ✓
            </span>
            <span className="toast__message">{toast.message}</span>
            {toast.action}
          </div>
        )}
      </DismissContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function useDismissToast() {
  return useContext(DismissContext);
}
