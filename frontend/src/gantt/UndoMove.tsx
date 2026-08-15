import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

import { projectQueryKey } from "../api/projects";
import type { ProjectState } from "../api/projects";
import { useDismissToast } from "../components/toast";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Состояние проекта из кэша — наблюдателем, а не вторым запросом.
 *
 * Свежесть держит экран проекта: он перечитывает состояние после каждой своей
 * правки и по каждому сигналу из сокета. Здесь нужно одно число из него, и
 * собственный `useQuery` означал бы лишний GET на каждый перенос полоски.
 */
function useCachedProject(projectId: string): ProjectState | undefined {
  const queryClient = useQueryClient();

  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const read = useCallback(
    () => queryClient.getQueryData<ProjectState>(projectQueryKey(projectId)),
    [queryClient, projectId],
  );

  return useSyncExternalStore(subscribe, read);
}

/**
 * «Отменить» в тосте после переноса полоски.
 *
 * Кнопка обещает вернуть конкретный перенос — тот, номер которого сервер
 * назвал в ответе на него. Пока тост висит свои шесть секунд, верх журнала
 * успевает уехать: сосед по проекту применил свою правку по сокету, сам
 * человек поправил что-то в карточке. Отмена «последнего» в этот момент сняла
 * бы не тот шаг, поэтому кнопка гаснет, как только верх журнала перестал быть
 * тем, что она называет.
 *
 * Сверка тут — вежливость, а не защита: между взглядом на кэш и ответом
 * сервера лежит сеть, и в этот зазор изменение влезает ровно так же. Защита —
 * `expected_seq` в запросе: сервер сверяет номер под замком проекта и
 * отказывает (`undo_conflict`), а не отменяет вслепую.
 */
export function UndoMove({
  projectId,
  seq,
  onUndo,
}: {
  projectId: string;
  /** Номер ревизии, отмену которой обещает кнопка. */
  seq: number;
  onUndo: () => void;
}) {
  const { t } = useLocale();
  const dismiss = useDismissToast();
  const state = useCachedProject(projectId);

  // Состояния в кэше нет — экран проекта закрыли, пока висел тост. Это не
  // «верх журнала уехал», а «неизвестно», и гасить кнопку не за что: решит
  // сервер, он всё равно последняя инстанция.
  const stale = state !== undefined && state.undoable?.seq !== seq;

  return (
    <button
      type="button"
      className="toast__action"
      disabled={stale}
      title={stale ? t("undo.stale") : undefined}
      onClick={() => {
        // Сначала спрятать, потом действовать: отмена сама покажет результат
        // на ленте, а висящий тост предлагал бы отменить уже отменённое.
        dismiss();
        onUndo();
      }}
    >
      {t("undo.action")}
    </button>
  );
}
