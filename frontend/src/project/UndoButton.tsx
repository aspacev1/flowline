import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "../api/client";
import { errorKey } from "../api/errors";
import { projectQueryKey, undoBatch, undoLast } from "../api/projects";
import type { ProjectState } from "../api/projects";
import { useLocale } from "../i18n/LocaleProvider";
import { formatEvent } from "../task/formatEvent";
import { useAskShiftReason } from "./ShiftReason";
import { thresholdOf } from "./baseline";

/**
 * Кнопка «Отменить».
 *
 * Называет, что именно она отменит: «Отменить: перенёс старт с 12 на 19
 * марта». Безымянная кнопка отмены заставляет вспоминать, что было последним
 * действием, — а вспоминают неверно как раз тогда, когда торопятся исправить
 * ошибку.
 *
 * Пачку отменяет целиком: применение AI — это десятки операций с общим
 * `batch_id`, и отменять их по одной значило бы тридцать нажатий подряд.
 */
export function UndoButton({ projectId, state }: { projectId: string; state: ProjectState }) {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const askReason = useAskShiftReason();
  const [error, setError] = useState<unknown>(null);

  const undoable = state.undoable;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!undoable) return;
      if (undoable.batch_id) {
        await undoBatch(projectId, undoable.batch_id);
        return;
      }
      try {
        await undoLast(projectId);
      } catch (refusal) {
        // Отмена подчиняется тому же правилу порога, что и всякий сдвиг: если
        // возврат уводит задачу от базового плана дальше порога, объяснение
        // нужно ровно так же. Числа берутся из подсказок сервера — своих у
        // вкладки здесь нет: она не знает, к каким датам приведёт обратная
        // операция.
        if (!(refusal instanceof ApiError) || refusal.code !== "reason_required") throw refusal;
        if (!askReason) throw refusal;
        const reason = await askReason({
          taskName: "",
          deviationDays: refusal.hints.deviationDays ?? 0,
          thresholdDays: refusal.hints.thresholdDays ?? thresholdOf(state),
        });
        if (reason === null) return;
        await undoLast(projectId, reason);
      }
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
    },
    onError: setError,
  });

  if (!undoable) return null;

  const what = formatEvent(undoable.op, locale);

  return (
    <>
      <button
        type="button"
        className="button--quiet"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        title={what}
      >
        {undoable.batch_id ? t("undo.batch") : t("undo.last", { what })}
      </button>
      {error !== null && (
        <span className="error" role="alert">
          {t(errorKey(error))}
        </span>
      )}
    </>
  );
}
