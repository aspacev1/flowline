import { request } from "./client";
import type { Criticality } from "./projects";

export const AI_CREDENTIAL_QUERY_KEY = ["ai", "credential"] as const;

/** Подключение LLM. Ключа здесь нет и быть не может — только признак. */
export type LlmCredential = {
  provider: string;
  base_url: string;
  model: string;
  configured: boolean;
};

export type DraftTask = {
  name: string;
  description?: string;
  start_date: string;
  duration_days: number;
  criticality?: Criticality;
};

export type DraftCategory = { name: string; tasks: DraftTask[] };
export type Draft = { categories: DraftCategory[] };

export type AiSession = {
  id: string;
  status: "interview" | "summary" | "draft" | "applied" | "abandoned";
  locale: string;
  transcript: { question: string; answer: string | null; covered: string[] }[];
  summary: string[];
  draft: Draft | Record<string, never>;
  tokens_used: number;
  project_id: string | null;
  applied_batch_id: string | null;
};

export function readCredential(): Promise<LlmCredential> {
  return request<LlmCredential>("/api/ai/credential");
}

export function saveCredential(payload: {
  provider?: string;
  base_url: string;
  model: string;
  api_key: string;
}): Promise<LlmCredential> {
  return request<LlmCredential>("/api/ai/credential", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function startSession(locale: string): Promise<AiSession> {
  return request<AiSession>("/api/ai/sessions", {
    method: "POST",
    body: JSON.stringify({ locale }),
  });
}

export function answerQuestion(sessionId: string, text: string): Promise<AiSession> {
  return request<AiSession>(`/api/ai/sessions/${sessionId}/answers`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

/** Ворота 1: «вот что я понял про проект». */
export function buildSummary(sessionId: string): Promise<AiSession> {
  return request<AiSession>(`/api/ai/sessions/${sessionId}/summary`, { method: "POST" });
}

export function editSummary(sessionId: string, theses: string[]): Promise<AiSession> {
  return request<AiSession>(`/api/ai/sessions/${sessionId}/summary`, {
    method: "PUT",
    body: JSON.stringify({ theses }),
  });
}

/** Ворота 2, главные: черновик. В проект не записано ничего. */
export function buildDraft(sessionId: string): Promise<AiSession> {
  return request<AiSession>(`/api/ai/sessions/${sessionId}/draft`, { method: "POST" });
}

export function editDraft(sessionId: string, draft: Draft): Promise<AiSession> {
  return request<AiSession>(`/api/ai/sessions/${sessionId}/draft`, {
    method: "PUT",
    body: JSON.stringify({ draft }),
  });
}

export function applySession(
  sessionId: string,
  name: string,
): Promise<{ project_id: string; batch_id: string; session: AiSession }> {
  return request(`/api/ai/sessions/${sessionId}/apply`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}
