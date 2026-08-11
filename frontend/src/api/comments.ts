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

export function commentsQueryKey(projectId: string) {
  return ["project", projectId, "comments"] as const;
}

export function listComments(projectId: string): Promise<Comment[]> {
  return request<Comment[]>(`/api/projects/${projectId}/comments`);
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
