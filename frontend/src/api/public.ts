import { request } from "./client";
import type { Comment } from "./comments";
import type { ProjectState } from "./projects";

/**
 * Публичная страница: то же состояние проекта плюс то, что есть только у неё.
 *
 * Исполнители в нём всегда пусты, а внутренней заметки нет вовсе — это решает
 * сервер, а не разметка. Тип честно наследует `ProjectState`: поля те же,
 * иначе публичная страница не смогла бы отдать его той же диаграмме.
 */
export type PublicProjectState = ProjectState & {
  org: { name: string; slug: string };
  comments_enabled: boolean;
};

export function publicProjectQueryKey(orgSlug: string, projectSlug: string, token: string) {
  return ["public", orgSlug, projectSlug, token] as const;
}

export function publicCommentsQueryKey(orgSlug: string, projectSlug: string, token: string) {
  return ["public", orgSlug, projectSlug, token, "comments"] as const;
}

function publicPath(orgSlug: string, projectSlug: string, token: string, suffix = ""): string {
  // Токен уходит параметром запроса — так же, как он приходит в адресе
  // страницы. Кодируется каждая часть: слаг строит сервер, но подставляет их
  // сюда адресная строка, а в ней может оказаться что угодно.
  const path = `/api/public/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}`;
  return `${path}${suffix}?s=${encodeURIComponent(token)}`;
}

export function getPublicProject(
  orgSlug: string,
  projectSlug: string,
  token: string,
): Promise<PublicProjectState> {
  return request<PublicProjectState>(publicPath(orgSlug, projectSlug, token));
}

export function listPublicComments(
  orgSlug: string,
  projectSlug: string,
  token: string,
): Promise<Comment[]> {
  return request<Comment[]>(publicPath(orgSlug, projectSlug, token, "/comments"));
}

export function addPublicComment(
  orgSlug: string,
  projectSlug: string,
  token: string,
  comment: { name: string; body: string; task_id?: string },
): Promise<Comment> {
  return request<Comment>(publicPath(orgSlug, projectSlug, token, "/comments"), {
    method: "POST",
    body: JSON.stringify(comment),
  });
}
