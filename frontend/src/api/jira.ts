import { request } from "./client";

export const JIRA_CREDENTIAL_QUERY_KEY = ["jira", "credential"] as const;
export const JIRA_PROJECTS_QUERY_KEY = ["jira", "projects"] as const;

/** Ключ проекта, задан из адреса самого проекта в его карточке. */
export function jiraLinkQueryKey(projectId: string) {
  return ["jira", "link", projectId] as const;
}

/** Подключение Jira. Токена здесь нет и быть не может — только признак. */
export type JiraCredential = {
  base_url: string;
  email: string;
  configured: boolean;
};

export type JiraProject = {
  key: string;
  name: string;
};

export type JiraImportResult = {
  project_id: string;
  batch_id: string;
  created_categories: number;
  created_tasks: number;
};

export type JiraSyncResult = {
  batch_id: string;
  created_categories: number;
  created_tasks: number;
  updated_tasks: number;
};

/** Заведён ли проект импортом из Jira, и когда синхронизировался в последний раз. */
export type JiraLink = {
  linked: boolean;
  jira_project_key: string | null;
  jql: string | null;
  last_synced_at: string | null;
};

export function readJiraCredential(): Promise<JiraCredential> {
  return request<JiraCredential>("/api/jira/credential");
}

export function saveJiraCredential(payload: {
  base_url: string;
  email: string;
  api_token: string;
}): Promise<JiraCredential> {
  return request<JiraCredential>("/api/jira/credential", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function disconnectJira(): Promise<void> {
  return request<void>("/api/jira/credential", { method: "DELETE" });
}

export function listJiraProjects(): Promise<JiraProject[]> {
  return request<JiraProject[]>("/api/jira/projects");
}

export function importFromJira(payload: {
  jira_project_key: string;
  name: string;
}): Promise<JiraImportResult> {
  return request<JiraImportResult>("/api/jira/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function readJiraLink(projectId: string): Promise<JiraLink> {
  return request<JiraLink>(`/api/projects/${projectId}/jira`);
}

export function syncFromJira(projectId: string): Promise<JiraSyncResult> {
  return request<JiraSyncResult>(`/api/projects/${projectId}/jira/sync`, { method: "POST" });
}
