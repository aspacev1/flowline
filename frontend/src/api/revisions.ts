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

export type RevisionEntry = {
  seq: number;
  created_at: string;
  /** Автора может не быть: операции AI и системные записи идут без человека. */
  actor: { id: string; name: string } | null;
  /** Причина сдвига — текст человека. Не переводится. */
  reason: string | null;
  /** Событие параметрами. Во фразу его собирает клиент, на языке читателя. */
  op: Record<string, unknown>;
};

export function listTaskRevisions(projectId: string, taskId: string): Promise<RevisionEntry[]> {
  return request<RevisionEntry[]>(
    `/api/projects/${projectId}/revisions?task_id=${encodeURIComponent(taskId)}`,
  );
}
