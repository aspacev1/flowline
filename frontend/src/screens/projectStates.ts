import { useQueries, useQuery } from "@tanstack/react-query";

import {
  PROJECTS_QUERY_KEY,
  getProject,
  listProjects,
  projectQueryKey,
} from "../api/projects";
import type { Project, ProjectState } from "../api/projects";

/**
 * Все проекты организации с их состояниями — сырьё «Проектов», «Моих задач» и
 * «Отчётов».
 *
 * Список, затем состояние каждого проекта по отдельности: сводного маршрута
 * на сервере нет, а ключи совпадают с ключами экрана проекта — то, что уже
 * открывали, приходит из кэша, и список не платит вторым запросом за то,
 * на что человек только что смотрел. Установки этого продукта — команды на
 * единицы проектов, не порталы на сотни: веер запросов здесь дешевле нового
 * серверного маршрута, который пришлось бы держать в согласии с основным.
 *
 * Список и состояния разделены и в ответе тоже. Экран проектов рисует имена
 * сразу, как только пришёл список, и дополняет карточки сводкой по мере того,
 * как приходят состояния: ждать общего «готово» значило бы держать пустой
 * экран из-за одного медленного проекта. Отчётам и «Моим задачам» нужно всё
 * сразу — им остаются `pending` и `error`.
 */
export function useProjectStates(): {
  /** Список и все состояния до единого. */
  pending: boolean;
  /** Первая ошибка любого из запросов. */
  error: unknown;
  /** Только список: по нему рисуются имена карточек. */
  listPending: boolean;
  /**
   * Только отказ списка. Отдельно от общего: не пришедшее состояние одного
   * проекта — это карточка без сводки, а не экран без проектов, и баннер
   * «сервер недоступен» поверх нормально загруженного списка врал бы.
   */
  listError: unknown;
  projects: Project[];
  states: ProjectState[];
  stateById: Map<string, ProjectState>;
} {
  const list = useQuery({ queryKey: PROJECTS_QUERY_KEY, queryFn: listProjects, retry: false });

  const details = useQueries({
    queries: (list.data ?? []).map((project) => ({
      queryKey: projectQueryKey(project.id),
      queryFn: () => getProject(project.id),
      retry: false,
    })),
  });

  const states = details
    .map((query) => query.data)
    .filter((state): state is ProjectState => state !== undefined);

  return {
    pending: list.isPending || details.some((query) => query.isPending),
    // Первая ошибка, а не все: экраны показывают одну строку отказа, и список
    // из пяти одинаковых «сервер недоступен» не сообщил бы ничего сверх неё.
    error: list.error ?? details.find((query) => query.error)?.error ?? null,
    listPending: list.isPending,
    listError: list.error ?? null,
    projects: list.data ?? [],
    states,
    stateById: new Map(states.map((state) => [state.id, state])),
  };
}
