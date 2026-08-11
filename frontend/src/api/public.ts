import { request } from "./client";
import type { Comment } from "./comments";
import type { ProjectState } from "./projects";

/**
 * Ключ публичной страницы — по слагам, а не по идентификатору проекта:
 * идентификатора гость не знает и знать не должен.
 */
export function publicProjectKey(orgSlug: string, projectSlug: string) {
  return ["public", orgSlug, projectSlug] as const;
}

export function publicCommentsKey(orgSlug: string, projectSlug: string) {
  return ["public", orgSlug, projectSlug, "comments"] as const;
}

/**
 * Проект глазами гостя.
 *
 * `internal_note` и `assignee_ids` необязательны не по забывчивости: сервер их
 * не присылает вовсе, и тип обязан описывать это честно — иначе разметка
 * однажды обратится к полю, которого в ответе нет.
 */
export type PublicProjectState = ProjectState & { comments_enabled: boolean };

function base(orgSlug: string, projectSlug: string): string {
  return `/api/public/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}`;
}

export function getPublicProject(
  orgSlug: string,
  projectSlug: string,
): Promise<PublicProjectState> {
  return request<PublicProjectState>(base(orgSlug, projectSlug));
}

export function listPublicComments(orgSlug: string, projectSlug: string): Promise<Comment[]> {
  return request<Comment[]>(`${base(orgSlug, projectSlug)}/comments`);
}

export function postPublicComment(
  orgSlug: string,
  projectSlug: string,
  body: string,
  guestName: string,
): Promise<Comment> {
  return request<Comment>(`${base(orgSlug, projectSlug)}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, guest_name: guestName }),
  });
}
