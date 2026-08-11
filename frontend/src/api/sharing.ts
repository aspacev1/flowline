import { request } from "./client";

/** Ключ настроек лежит под ключом проекта, как журнал и обсуждение. */
export function settingsQueryKey(projectId: string) {
  return ["project", projectId, "settings"] as const;
}

export type Share = {
  published: boolean;
  /**
   * Положение переключателя, а не «есть ли комментарии сейчас». Снятая
   * публикация его помнит: иначе он прыгал бы сам собой при отзыве ссылки.
   */
  comments_enabled: boolean;
};

export type ProjectSettings = {
  slug: string;
  /**
   * Полный адрес публичной страницы, собранный сервером.
   *
   * Не склеивается в браузере: слаги нормализует сервер, а базовый адрес он
   * же и знает — за обратным прокси адрес, по которому открыт браузер, и
   * адрес установки это разные вещи.
   */
  public_url: string;
  /** Запрет уровня организации. Выключен — публиковать нельзя ничего. */
  public_sharing_enabled: boolean;
  share: Share;
};

export type SlugCheck = {
  available: boolean;
  /** Свободный вариант: сам слаг, если он свободен, иначе — с суффиксом. */
  suggestion: string;
};

export function projectSettings(projectId: string): Promise<ProjectSettings> {
  return request<ProjectSettings>(`/api/projects/${projectId}/settings`);
}

export function setShare(projectId: string, share: Share): Promise<Share> {
  return request<Share>(`/api/projects/${projectId}/share`, {
    method: "PUT",
    body: JSON.stringify(share),
  });
}

export function checkSlug(projectId: string, slug: string): Promise<SlugCheck> {
  return request<SlugCheck>(
    `/api/projects/${projectId}/slug-check?slug=${encodeURIComponent(slug)}`,
  );
}

export function renameSlug(
  projectId: string,
  slug: string,
): Promise<{ slug: string; public_url: string }> {
  return request<{ slug: string; public_url: string }>(`/api/projects/${projectId}/slug`, {
    method: "PUT",
    body: JSON.stringify({ slug }),
  });
}
