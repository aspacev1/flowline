import { useEffect } from "react";

import { errorKey } from "../api/errors";
import type { ProjectState } from "../api/projects";
import { isTextEntry, isUndoChord } from "../components/hotkeys";
import { useToast } from "../components/toast";
import { useLocale } from "../i18n/LocaleProvider";
import { useUndo } from "./useUndo";

/**
 * Ctrl/⌘+Z на весь экран проекта.
 *
 * Отмена в приложении была, но добраться до неё можно было только мышью — из
 * тоста сразу после переноса или из ленты истории, то есть с другой вкладки.
 * Человек, подвинувший полоску не туда, жмёт Ctrl+Z не задумываясь; сочетание,
 * которого нет, читается как «отменить нельзя».
 *
 * Слушатель на документе, а не на ленте: отменяют не то, что под фокусом, а
 * последнее сделанное в проекте, и работать это обязано на обеих вкладках и
 * при фокусе где угодно. Компонент ничего не рисует — он живёт ради этого
 * слушателя и ради `useUndo`, которому нужно состояние проекта; узел без
 * разметки честнее, чем хук, вызванный посреди экрана, у которого до
 * состояния три ранних возврата.
 */
export function UndoHotkey({
  projectId,
  state,
  enabled,
}: {
  projectId: string;
  state: ProjectState;
  /** Право и возможность отменять — тот же признак, что у кнопки в ленте. */
  enabled: boolean;
}) {
  const { t } = useLocale();
  const showToast = useToast();
  const { undoable, mutation } = useUndo(projectId, state);
  const { mutate, isPending } = mutation;

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      if (!isUndoChord(event) || isTextEntry(event.target)) return;
      // Пока открыто окно, Ctrl+Z принадлежит окну: человек правит форму
      // задачи, а не ленту за ней, и отменять у него за спиной чужой перенос
      // — не то, о чём он просил. Сюда же попадает окно с причиной сдвига:
      // второе нажатие во время вопроса завело бы вторую отмену.
      if (document.querySelector('[role="dialog"]') !== null) return;
      event.preventDefault();

      if (!undoable) {
        // Молчание читалось бы как сломанная клавиша: приложение обязано
        // ответить и на «отменять нечего».
        showToast({ message: t("undo.nothing") });
        return;
      }
      if (isPending) return;

      mutate(undefined, {
        // Тост — единственное подтверждение для того, кто нажал клавишу: на
        // ленте полоска уезжает на глазах, но на вкладке истории отмена иначе
        // выглядит как ничего не произошло.
        onSuccess: (undone) => {
          if (undone) showToast({ message: t("undo.done") });
        },
        // Отказ — тоном отказа: галочка рядом с «отменить этот перенос уже
        // нельзя» сообщает ровно обратное тому, что случилось, а `role="status"`
        // прячет отказ от читалки в сводку, тогда как отменить не удалось.
        onError: (error) => showToast({ message: t(errorKey(error)), tone: "error" }),
      });
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, isPending, mutate, showToast, t, undoable]);

  return null;
}
