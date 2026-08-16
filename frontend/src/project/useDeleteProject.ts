import { useMutation, useQueryClient } from "@tanstack/react-query";

import { PROJECTS_QUERY_KEY, deleteProject, projectQueryKey } from "../api/projects";
import type { Project } from "../api/projects";
import { useToast } from "../components/toast";
import { useLocale } from "../i18n/LocaleProvider";

/** Что удаляем. Имя — не для запроса, а для тоста; см. ниже, почему оно здесь. */
export type DeletedProject = { id: string; name: string };

/**
 * Удаление проекта вместе со всем, что после него обязано случиться в кэше.
 *
 * Отдельный хук, а не мутация внутри экрана: расстаться с проектом можно из
 * его настроек и с карточки в списке, а правил после успеха три — убрать
 * проект из списка, выбросить его состояние и назвать человеку то, что
 * удалено. Второй набор этих правил разошёлся бы с первым на первой же
 * правке, и разошёлся бы молча.
 *
 * Имя приходит вместе с запросом, а не читается из кэша в обработчике: к
 * моменту успеха проекта нет ни на сервере, ни в кэше — а назвать в тосте
 * нужно именно то, что удалили.
 *
 * `onDeleted` — то, что после удаления делает уже сам экран: настройки уходят
 * на список, список закрывает окно подтверждения. Кэш к этому отношения не
 * имеет, и хук за экран этого не решает.
 */
export function useDeleteProject({ onDeleted }: { onDeleted?: () => void } = {}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const showToast = useToast();

  return useMutation({
    mutationFn: ({ id }: DeletedProject) => deleteProject(id),
    onSuccess: (_result, { id, name }: DeletedProject) => {
      // Список правится на месте, а не только помечается устаревшим: до
      // ответа на перезапрос он показывал бы карточку того, чего уже нет, —
      // и человек, нажавший «Удалить», секунду смотрел бы на несделанное.
      queryClient.setQueryData(PROJECTS_QUERY_KEY, (projects: Project[] | undefined) =>
        projects?.filter((project) => project.id !== id),
      );
      // Кэш проекта не инвалидируется, а выбрасывается: перезапрос по этому
      // ключу теперь может ответить только 404-й.
      queryClient.removeQueries({ queryKey: projectQueryKey(id) });
      // И всё же перезапрашивается: правка на месте — это догадка о том, что
      // на сервере, а список обязан сойтись с ним, а не с ней.
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
      // Отмены тост не предлагает намеренно — вместе с проектом ушёл журнал
      // ревизий, и возвращать состояние неоткуда; об этом честно сказано и в
      // подтверждении, которое человек только что прочитал.
      showToast({ message: t("settings.project.deleted", { name }) });
      onDeleted?.();
    },
  });
}
