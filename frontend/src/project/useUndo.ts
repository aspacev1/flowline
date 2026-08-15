import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "../api/client";
import { projectQueryKey, undoBatch, undoLast } from "../api/projects";
import type { ProjectState } from "../api/projects";
import { useAskShiftReason } from "./ShiftReason";
import { thresholdOf } from "./baseline";

/**
 * Отмена последнего изменения — механика кнопок в ленте истории.
 *
 * Кнопка отменяет строго то, что сервер назвал в `state.undoable`: выбор
 * отменяемого — решение сервера, и лента его не переспаривает. Номер этой
 * записи уходит в запрос: между отрисовкой ленты и нажатием сосед успевает
 * применить своё изменение, и безномерная отмена сняла бы его правку вместо
 * названной. Тост после переноса полоски (useDragDates) зовёт ту же ручку
 * отдельно и с тем же условием — только номер берёт из ответа на свой перенос.
 *
 * Пачку отменяет целиком: применение AI — это десятки операций с общим
 * `batch_id`, и отменять их по одной значило бы тридцать нажатий подряд.
 *
 * Ctrl/⌘+Z (`UndoHotkey`) зовёт отсюда же: горячая клавиша — второй путь к
 * той же кнопке, а не второй способ отменять.
 */
export function useUndo(projectId: string, state: ProjectState) {
  const queryClient = useQueryClient();
  const askReason = useAskShiftReason();
  const [error, setError] = useState<unknown>(null);

  const undoable = state.undoable;

  const mutation = useMutation({
    // Возвращает, случилась ли отмена на самом деле: отменять было нечего или
    // человек закрыл окно с причиной — это успех запроса и не-событие для
    // того, кто ждёт подтверждения. Без этого признака горячая клавиша
    // рапортовала бы «отменено» там, где не отменено ничего.
    mutationFn: async (): Promise<boolean> => {
      if (!undoable) return false;
      if (undoable.batch_id) {
        await undoBatch(projectId, undoable.batch_id);
        return true;
      }
      try {
        // Номер той самой записи, которую кнопка назвала человеку: между
        // отрисовкой ленты и нажатием сосед успевает применить своё изменение,
        // и безномерная отмена сняла бы его правку вместо названной.
        await undoLast(projectId, { seq: undoable.seq });
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
        if (reason === null) return false;
        await undoLast(projectId, { seq: undoable.seq, reason });
      }
      return true;
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
    },
    onError: setError,
  });

  return { undoable, mutation, error };
}
