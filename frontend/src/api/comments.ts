import { request } from "./client";

export type Comment = {
  id: string;
  /** `null` — реплика к проекту целиком, а не к задаче. */
  task_id: string | null;
  /**
   * Подпись под репликой. Гость и участник подписаны одинаково — именем;
   * различает их признак `guest`, а не форма записи.
   */
  author: { name: string; guest: boolean };
  body: string;
  created_at: string;
};

export function commentsQueryKey(projectId: string, taskId?: string) {
  // Задача в конце ключа, а не отдельным ключом: лента задачи — это та же
  // лента проекта, отфильтрованная сервером, и обновление одной обязано
  // задевать другую.
  return taskId === undefined
    ? (["project", projectId, "comments"] as const)
    : (["project", projectId, "comments", taskId] as const);
}

/**
 * Ключ счётчика реплик — внутри ключа ленты, а не рядом с ним.
 *
 * Счётчик обязан обновляться ровно тогда же, когда сама лента: своей репликой
 * из карточки и чужой, приехавшей по сокету. Оба места уже сбрасывают ленту
 * проекта целиком, и вложенный ключ подхватывается тем же вызовом. Отдельный
 * пришлось бы сбрасывать вторым — и однажды его бы забыли.
 */
export function commentCountsQueryKey(projectId: string) {
  return ["project", projectId, "comments", "counts"] as const;
}

/**
 * Сколько реплик у каждой задачи — число, которое лента показывает на строке.
 *
 * Отдельным запросом, а не подсчётом по ленте: лента отдаётся хвостом в сотню
 * реплик, и счёт по ней врал бы ровно там, где переписки много. Задачи без
 * реплик в ответе отсутствуют: ноль — это отсутствие ключа.
 */
export function commentCounts(projectId: string): Promise<Record<string, number>> {
  return request<Record<string, number>>(`/api/projects/${projectId}/comments/counts`);
}

export function listComments(projectId: string, taskId?: string): Promise<Comment[]> {
  const query = taskId === undefined ? "" : `?task_id=${encodeURIComponent(taskId)}`;
  return request<Comment[]>(`/api/projects/${projectId}/comments${query}`);
}

export function addComment(
  projectId: string,
  body: string,
  taskId?: string,
): Promise<Comment> {
  return request<Comment>(`/api/projects/${projectId}/comments`, {
    method: "POST",
    body: JSON.stringify(taskId === undefined ? { body } : { body, task_id: taskId }),
  });
}
