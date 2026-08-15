import { useQueries, useQuery } from "@tanstack/react-query";

import {
  PROJECTS_QUERY_KEY,
  getProject,
  listProjects,
  projectQueryKey,
} from "../api/projects";
import type { Project, ProjectState } from "../api/projects";

/**
 * Все проекты организации с их состояниями — сырьё «Портфеля», «Моих задач» и
 * «Отчётов».
 *
 * Список, затем состояние каждого проекта по отдельности: сводного маршрута
 * на сервере нет, а ключи совпадают с ключами экрана проекта — то, что уже
 * открывали, приходит из кэша, и «Портфель» не платит вторым запросом за то,
 * на что человек только что смотрел. Установки этого продукта — команды на
 * единицы проектов, не порталы на сотни: веер запросов здесь дешевле нового
 * серверного маршрута, который пришлось бы держать в согласии с основным.
 */
export function useProjectStates(): {
  pending: boolean;
  error: unknown;
  projects: Project[];
  states: ProjectState[];
} {
  const list = useQuery({ queryKey: PROJECTS_QUERY_KEY, queryFn: listProjects, retry: false });

  const details = useQueries({
    queries: (list.data ?? []).map((project) => ({
      queryKey: projectQueryKey(project.id),
      queryFn: () => getProject(project.id),
      retry: false,
    })),
  });

  return {
    pending: list.isPending || details.some((query) => query.isPending),
    // Первая ошибка, а не все: экраны показывают одну строку отказа, и список
    // из пяти одинаковых «сервер недоступен» не сообщил бы ничего сверх неё.
    error: list.error ?? details.find((query) => query.error)?.error ?? null,
    projects: list.data ?? [],
    states: details
      .map((query) => query.data)
      .filter((state): state is ProjectState => state !== undefined),
  };
}
