import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { ApiError } from "../api/client";
import { applyOp, projectQueryKey } from "../api/projects";
import type { Op, ProjectState, Revision } from "../api/projects";
import { useLiveBlocksEditing } from "../live/LiveProvider";

/** Код отказа, когда связь оборвана. Придуман клиентом: запрос не уходит вовсе. */
export const OFFLINE_ERROR_CODE = "offline";

/**
 * Преобразование состояния, показывающее изменение до ответа сервера.
 *
 * Возвращает новое состояние, а не правит переданное: старое остаётся снимком
 * для отката, и порча его на месте лишила бы откат того, к чему возвращаться.
 */
export type Optimistic = (state: ProjectState) => ProjectState;

export type ApplyOptions = {
  /** Причина сдвига — текст человека. Отсутствие ключа и пустая строка различаются. */
  reason?: string;
};

/**
 * Единственный путь любого изменения проекта: показать сразу, отправить,
 * вернуть как было при отказе.
 *
 * Путь один на все жесты сознательно. Перетаскивание, правка поля в карточке и
 * перестановка строки отличаются только тем, что показать до ответа, — а
 * порядок «снимок → показ → отправка → откат или перезапрос» у них общий.
 * Написанный в каждом жесте заново, он в каждом расходится по мелочи, и
 * расхождение видно только тогда, когда сервер отказал, то есть в самый
 * неудачный момент.
 */
export function useProjectMutation(projectId: string) {
  const queryClient = useQueryClient();
  const key = projectQueryKey(projectId);
  // Блокировка при обрыве связи стоит здесь, а не в каждом жесте (§12). Это
  // единственная дорога любого изменения, и всякий следующий жест окажется
  // заперт сам, без напоминания автору. Спрятанная кнопка при этом не отменяет
  // проверку: перетаскивание и клавиатура мимо кнопок ходят.
  const blocked = useLiveBlocksEditing();

  const apply = useCallback(
    async (op: Op, optimistic: Optimistic, options?: ApplyOptions): Promise<Revision> => {
      // Отказ до всякого показа: изменение, показанное и тут же откаченное,
      // мигает — а отправлять его некуда, состояние на экране устарело
      // неизвестно насколько, и операция ляжет поверх чужих правок вслепую.
      if (blocked) throw new ApiError(OFFLINE_ERROR_CODE, 0);

      // Снимок берётся здесь, непосредственно перед применением, а не один раз
      // при монтировании: иначе откат второго изменения возвращает состояние к
      // тому, что было до первого, и стирает его заодно.
      const snapshot = queryClient.getQueryData<ProjectState>(key);

      // Показ идёт до всякого ожидания, синхронно. Жест обязан отозваться в
      // том же кадре, в котором его сделали; отложенный на микрозадачу показ —
      // это уже заметное запаздывание под пальцем.
      if (snapshot) queryClient.setQueryData(key, optimistic(snapshot));

      // Фоновый перезапрос, начатый до жеста, вернул бы состояние без него.
      await queryClient.cancelQueries({ queryKey: key });

      try {
        const revision = await applyOp(projectId, op, options?.reason);
        // Версия сервера единственно верная: даты окончания считает он, и
        // оптимистичное состояние в лучшем случае совпадает с его ответом.
        await queryClient.invalidateQueries({ queryKey: key });
        return revision;
      } catch (error) {
        if (snapshot) queryClient.setQueryData(key, snapshot);
        throw error;
      }
    },
    [projectId, queryClient, key, blocked],
  );

  return { apply };
}
