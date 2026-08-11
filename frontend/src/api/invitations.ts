import { request } from "./client";

export const INVITATIONS_QUERY_KEY = ["org", "invitations"] as const;

/** Ключ приглашения по токену: у каждой ссылки свой, экранов приёма может быть несколько. */
export function inviteQueryKey(token: string) {
  return ["invitation", token] as const;
}

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type Invitation = {
  id: string;
  /** null — приглашение только по ссылке: оно достаётся предъявителю. */
  email: string | null;
  role: string;
  status: InviteStatus;
  project_ids: string[];
  created_at: string;
  expires_at: string;
  last_sent_at: string | null;
  invited_by: string | null;
  accepted_at: string | null;
};

export type InvitationList = {
  /**
   * Настроена ли в установке почта. Без неё кнопка отправки не показывается
   * вовсе — установка без почтового сервера остаётся полноценной, а не
   * показывает кнопку, которая всегда отвечает отказом.
   */
  mail_enabled: boolean;
  invitations: Invitation[];
};

export type Issued = {
  id: string;
  email: string | null;
  role: string;
  expires_at: string;
  /**
   * Открытая ссылка. Приходит только в ответ на выпуск и больше нигде: в базе
   * лежит хеш токена, и второй раз её взять негде. Отсюда и поведение экрана —
   * ссылка показывается сразу и не прячется до следующего действия.
   */
  url: string;
  sent: boolean;
  /** Почему письмо не ушло. Приглашение при этом создано. */
  mail_error: string | null;
};

export type InviteInput = {
  emails: string[];
  role: string;
  project_ids?: string[];
  deliver?: boolean;
};

export type InvitePreview = {
  org_name: string;
  role: string;
  email: string | null;
  inviter_name: string | null;
  expires_at: string;
};

export type JoinedOrganization = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export function listInvitations(): Promise<InvitationList> {
  return request<InvitationList>("/api/org/invitations");
}

export function createInvitations(input: InviteInput): Promise<Issued[]> {
  return request<Issued[]>("/api/org/invitations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Новая ссылка взамен прежней — она же «отправить ещё раз». */
export function reissueInvitation(id: string, deliver: boolean): Promise<Issued> {
  return request<Issued>(`/api/org/invitations/${id}/reissue`, {
    method: "POST",
    body: JSON.stringify({ deliver }),
  });
}

export function revokeInvitation(id: string): Promise<void> {
  return request<void>(`/api/org/invitations/${id}`, { method: "DELETE" });
}

/** Что за приглашение на руках — отвечает и тому, кто ещё не вошёл. */
export function previewInvitation(token: string): Promise<InvitePreview> {
  return request<InvitePreview>(`/api/invitations/${encodeURIComponent(token)}`);
}

export function acceptInvitation(token: string): Promise<JoinedOrganization> {
  return request<JoinedOrganization>(`/api/invitations/${encodeURIComponent(token)}/accept`, {
    method: "POST",
  });
}
