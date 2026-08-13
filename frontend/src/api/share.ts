import { request } from "./client";

/** Ключ состояния публикации одного проекта. */
export function shareQueryKey(projectId: string) {
  return ["project", projectId, "share"] as const;
}

export type Share = {
  /**
   * Разрешены ли публичные ссылки вообще: рубильник установки и настройка
   * организации. Приходит и тогда, когда ссылки ещё нет, — иначе интерфейс не
   * отличит «не опубликован» от «публиковать запрещено» и предложит кнопку,
   * которая кончится отказом.
   */
  allowed: boolean;
  /** Полный адрес страницы. `null` — проект не опубликован. */
  url: string | null;
  comments_enabled: boolean;
  created_at: string | null;
};

export function getShare(projectId: string): Promise<Share> {
  return request<Share>(`/api/projects/${projectId}/share`);
}

/** Первый выпуск ссылки. Если она уже есть, сервер ответит 409 — повтор
 * запроса не убивает только что разосланный адрес. */
export function issueShare(projectId: string): Promise<Share> {
  return request<Share>(`/api/projects/${projectId}/share`, { method: "POST" });
}

/** Перевыпуск: старый адрес умирает мгновенно. Отдельный вызов, чтобы
 * «создать» и «убить прежний» нельзя было перепутать ретраем. */
export function rotateShare(projectId: string): Promise<Share> {
  return request<Share>(`/api/projects/${projectId}/share/rotate`, { method: "POST" });
}

export function setShareComments(projectId: string, enabled: boolean): Promise<Share> {
  return request<Share>(`/api/projects/${projectId}/share`, {
    method: "PATCH",
    body: JSON.stringify({ comments_enabled: enabled }),
  });
}

export function revokeShare(projectId: string): Promise<void> {
  return request<void>(`/api/projects/${projectId}/share`, { method: "DELETE" });
}
