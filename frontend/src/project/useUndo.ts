import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "../api/client";
import { projectQueryKey, undoBatch, undoLast } from "../api/projects";
import type { ProjectState } from "../api/projects";
import { useAskShiftReason } from "./ShiftReason";
import { thresholdOf } from "./baseline";

/**
 * Отмена последнего изменения — общая механика кнопки в шапке и ленты истории.
 *
 * Обе кнопки отменяют строго одно и то же — то, что сервер назвал в
 * `state.undoable`, — поэтому и код один: разъехавшись, две кнопки однажды
 * стали бы обещать разное.
 *
 * Пачку отменяет целиком: применение AI — это десятки операций с общим
 * `batch_id`, и отменять их по одной значило бы тридцать нажатий подряд.
 */
export function useUndo(projectId: string, state: ProjectState) {
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

  return { undoable, mutation, error };
}
