import { request } from "./client";

/**
 * Ключ журнала лежит под ключом проекта: `["project", id, ...]`.
 *
 * Это не украшение. Изменение проекта сбрасывает всё поддерево одним
 * `invalidateQueries` по префиксу, и история обновляется вместе с состоянием
 * сама — без отдельного списка ключей, который однажды забудут пополнить.
 */
export function revisionsQueryKey(projectId: string, taskId: string) {
  return ["project", projectId, "revisions", taskId] as const;
}

/** Лента всего проекта — своя ветка того же поддерева, с фильтрами в ключе. */
export function feedQueryKey(projectId: string, filters: FeedFilters) {
  return ["project", projectId, "revisions", "feed", filters] as const;
}

export type RevisionEntry = {
  seq: number;
  created_at: string;
  /** Автора может не быть: операции AI и системные записи идут без человека. */
  actor: { id: string; name: string } | null;
  /** Причина сдвига — текст человека. Не переводится. */
  reason: string | null;
  /** Общий у пачки, применённой одним действием (AI). */
  batch_id: string | null;
  /** Номер ревизии, которую эта отменила. `null` — обычная запись. */
  undoes_seq: number | null;
  /** Событие параметрами. Во фразу его собирает клиент, на языке читателя. */
  op: Record<string, unknown>;
  /**
   * Имена сущностей, которые упоминает операция, по идентификатору. Для
   * удалённых — из снимка восстановления: имя переживает удаление в журнале.
   */
  names: Record<string, string>;
};

export type FeedFilters = {
  taskId?: string;
  actorId?: string;
  /** Типы операций как их знает журнал; собираются из групп фильтра. */
  types?: string[];
};

export function listTaskRevisions(projectId: string, taskId: string): Promise<RevisionEntry[]> {
  return request<RevisionEntry[]>(
    `/api/projects/${projectId}/revisions?task_id=${encodeURIComponent(taskId)}`,
  );
}

/** Размер страницы ленты. Отдельной константой: по ней лента узнаёт последнюю
 *  страницу — короче предела значит «дальше ничего нет». */
export const FEED_PAGE = 50;

export function listProjectRevisions(
  projectId: string,
  filters: FeedFilters,
  beforeSeq?: number,
): Promise<RevisionEntry[]> {
  const params = new URLSearchParams();
  if (filters.taskId) params.set("task_id", filters.taskId);
  if (filters.actorId) params.set("actor_id", filters.actorId);
  for (const type of filters.types ?? []) params.append("types", type);
  if (beforeSeq !== undefined) params.set("before_seq", String(beforeSeq));
  params.set("limit", String(FEED_PAGE));
  return request<RevisionEntry[]>(`/api/projects/${projectId}/revisions?${params}`);
}
