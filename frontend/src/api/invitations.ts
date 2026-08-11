import { request } from "./client";

export const INVITATIONS_QUERY_KEY = ["org", "invitations"] as const;
export const CONFIG_QUERY_KEY = ["config"] as const;

/** Рубильники установки: что вообще имеет смысл показывать. */
export type InstallConfig = {
  mail_enabled: boolean;
  signup_mode: string;
  supported_locales: string[];
  default_locale: string;
  public_sharing_enabled: boolean;
};

export type IssuedInvitation = {
  id: string;
  email: string | null;
  role: string;
  expires_at: string;
  /**
   * Ссылка приходит ровно один раз — в ответе на создание или повторный
   * выпуск. Сервер её не помнит: в базе лежит хеш. Значит, показать её надо
   * сразу и до тех пор, пока человек её не заберёт.
   */
  link: string | null;
  sent: boolean;
  mail_error: string | null;
};

export type InvitationRow = {
  id: string;
  email: string | null;
  role: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
  last_sent_at: string | null;
};

export type InvitationPreview = {
  org_name: string;
  role: string;
  email: string | null;
  expires_at: string;
};

export function installConfig(): Promise<InstallConfig> {
  return request<InstallConfig>("/api/config");
}

export function listInvitations(): Promise<InvitationRow[]> {
  return request<InvitationRow[]>("/api/org/invitations");
}

export function createInvitations(payload: {
  emails: string[];
  role: string;
  project_ids?: string[];
  send_email?: boolean;
}): Promise<IssuedInvitation[]> {
  return request<IssuedInvitation[]>("/api/org/invitations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Новый токен взамен прежнего. Прежний умирает немедленно. */
export function reissueInvitation(id: string, sendEmail: boolean): Promise<IssuedInvitation> {
  return request<IssuedInvitation>(
    `/api/org/invitations/${id}/reissue?send_email=${sendEmail ? "true" : "false"}`,
    { method: "POST" },
  );
}

export function revokeInvitation(id: string): Promise<void> {
  return request<void>(`/api/org/invitations/${id}/revoke`, { method: "POST" });
}

export function previewInvitation(token: string): Promise<InvitationPreview> {
  return request<InvitationPreview>(`/api/invitations/${encodeURIComponent(token)}`);
}

export function acceptInvitation(
  token: string,
): Promise<{ org_id: string; org_name: string; role: string }> {
  return request(`/api/invitations/${encodeURIComponent(token)}/accept`, { method: "POST" });
}
