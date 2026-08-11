import { request } from "./client";

/**
 * Ключ ветки лежит под ключом проекта: `["project", id, ...]`.
 *
 * Та же причина, что и у журнала ревизий: изменение проекта сбрасывает всё
 * поддерево одним `invalidateQueries` по префиксу, и списку ключей, который
 * однажды забудут пополнить, взяться неоткуда.
 */
export function commentsQueryKey(projectId: string, taskId: string) {
  return ["project", projectId, "comments", taskId] as const;
}

export type Comment = {
  id: string;
  task_id: string | null;
  /** Текст человека. Не переводится. */
  body: string;
  created_at: string;
  /** Участник с аккаунтом — или null, если реплику оставил гость. */
  author: { id: string; name: string } | null;
  /** Имя гостя. Заполнено ровно тогда, когда `author` пуст. */
  guest_name: string | null;
};

export function listTaskComments(projectId: string, taskId: string): Promise<Comment[]> {
  return request<Comment[]>(
    `/api/projects/${projectId}/comments?task_id=${encodeURIComponent(taskId)}`,
  );
}

export function postComment(projectId: string, taskId: string, body: string): Promise<Comment> {
  return request<Comment>(`/api/projects/${projectId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, task_id: taskId }),
  });
}
