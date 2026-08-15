import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

import { Modal } from "../components/Modal";
import { useLocale } from "../i18n/LocaleProvider";
import type { ShiftRequest } from "./baseline";

/**
 * Окно, которое спрашивает причину сдвига.
 *
 * Живёт провайдером, а не куском разметки внутри жеста, потому что жестов
 * несколько — перетаскивание полоски, правка даты в карточке, изменение
 * длительности, — а окно у них одно и то же. Спецификация говорит об этом
 * прямо: правило одно независимо от способа ввода. Написанное в каждом жесте
 * заново, оно в каждом разъедется по мелочи, и разъедется незаметно.
 *
 * Спрашивает обещанием: жест ждёт ответа человека и продолжается или не
 * продолжается вовсе. Промежуточного состояния «сдвинуто, но не объяснено» не
 * возникает даже на кадр — изменение не отправляется, пока причина не введена.
 */

/** Отказ человека объяснять сдвиг. Не ошибка: жест просто не состоялся. */
export class ShiftCancelled extends Error {
  constructor() {
    super("сдвиг отменён: причина не введена");
    this.name = "ShiftCancelled";
  }
}

export function isShiftCancelled(error: unknown): boolean {
  return error instanceof ShiftCancelled;
}

/** `null` в ответе — человек нажал «Вернуть». */
type AskReason = (request: ShiftRequest) => Promise<string | null>;

const ShiftReasonContext = createContext<AskReason | null>(null);

type Pending = { request: ShiftRequest; answer: (reason: string | null) => void };

export function ShiftReasonProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback<AskReason>(
    (request) => new Promise<string | null>((resolve) => setPending({ request, answer: resolve })),
    [],
  );

  const close = useCallback(
    (reason: string | null) => {
      setPending((current) => {
        current?.answer(reason);
        return null;
      });
    },
    [],
  );

  return (
    <ShiftReasonContext.Provider value={ask}>
      {children}
      {pending && <ReasonDialog request={pending.request} onAnswer={close} />}
    </ShiftReasonContext.Provider>
  );
}

/**
 * Спрашивающая сторона.
 *
 * Вне провайдера возвращает `null`, а не бросает: карточка задачи и лента
 * рисуются и в тех местах, где окна нет вовсе (например, на публичной
 * странице, где менять нечего). Отсутствие окна тогда означает «не спрашиваем
 * здесь», а не поломку, — а последнее слово о причине всё равно за сервером.
 */
export function useAskShiftReason(): AskReason | null {
  return useContext(ShiftReasonContext);
}

function ReasonDialog({
  request,
  onAnswer,
}: {
  request: ShiftRequest;
  onAnswer: (reason: string | null) => void;
}) {
  const { t } = useLocale();
  const [reason, setReason] = useState("");
  // Пробелы причиной не считаются — ровно так же, как на сервере: иначе
  // кнопка оживала бы от пробела, а сервер отвечал бы отказом.
  const filled = reason.trim().length > 0;

  return (
    <Modal
      title={t("shift.title", { days: t("common.days", { count: request.deviationDays }) })}
      // Закрытие по Esc и щелчком мимо — тот же ответ, что и «Вернуть»:
      // изменение не применяется.
      onClose={() => onAnswer(null)}
      // Написанная причина делает промах дорогим вдвойне: пропадает и текст, и
      // сам сдвиг, ради которого его писали.
      dirty={filled}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (filled) onAnswer(reason.trim());
        }}
      >
        <p className="muted">
          {/* Название задачи — содержимое пользователя: не переводится. */}
          {t("shift.explain", {
            name: request.taskName,
            threshold: t("common.days", { count: request.thresholdDays }),
          })}
        </p>

        <p className="field">
          <label htmlFor="shift-reason">{t("shift.reason")}</label>
          <textarea
            id="shift-reason"
            name="shift-reason"
            rows={3}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </p>

        <div className="modal__actions">
          {/* Пустая причина — кнопка неактивна. Само изменение при этом никуда
              не ушло: спрашивают до отправки, а не после. */}
          <button type="submit" disabled={!filled}>
            {t("shift.save")}
          </button>
          <button type="button" className="button--quiet" onClick={() => onAnswer(null)}>
            {t("shift.revert")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
