import { request } from "./client";
import type { ProjectState } from "./projects";

export function publicProjectQueryKey(token: string) {
  return ["public", token] as const;
}

export function commentsQueryKey(scope: string) {
  return ["comments", scope] as const;
}

/** Проект по публичной ссылке: та же раскладка, но без внутренних заметок. */
export type PublicProject = ProjectState & {
  org_name: string;
  comments_enabled: boolean;
};

export type CommentEntry = {
  id: string;
  task_id: string | null;
  body: string;
  created_at: string;
  /** Имя человека или гостя — содержимое, а не чрома: не переводится. */
  author_name: string;
  is_guest: boolean;
};

export type Share = {
  url: string;
  comments_enabled: boolean;
  created_at: string;
};

export function publicProject(token: string): Promise<PublicProject> {
  return request<PublicProject>(`/api/public/${encodeURIComponent(token)}`);
}

export function publicComments(token: string): Promise<CommentEntry[]> {
  return request<CommentEntry[]>(`/api/public/${encodeURIComponent(token)}/comments`);
}

export function addPublicComment(
  token: string,
  payload: { body: string; guest_name: string; task_id?: string },
): Promise<CommentEntry> {
  return request<CommentEntry>(`/api/public/${encodeURIComponent(token)}/comments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function projectComments(projectId: string): Promise<CommentEntry[]> {
  return request<CommentEntry[]>(`/api/projects/${projectId}/comments`);
}

export function addProjectComment(
  projectId: string,
  payload: { body: string; task_id?: string },
): Promise<CommentEntry> {
  return request<CommentEntry>(`/api/projects/${projectId}/comments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** `null` — ссылки нет: проект наружу не показан. */
export function readShare(projectId: string): Promise<Share | null> {
  return request<Share | null>(`/api/projects/${projectId}/share`);
}

/** Выпустить — или перевыпустить: прежняя ссылка умирает мгновенно. */
export function issueShare(projectId: string): Promise<Share> {
  return request<Share>(`/api/projects/${projectId}/share`, {
    method: "POST",
    body: JSON.stringify({}),
  });
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
