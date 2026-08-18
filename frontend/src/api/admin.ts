import { request } from "./client";

export const ADMIN_USERS_QUERY_KEY = ["admin", "users"] as const;

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  /** Дата регистрации — момент, когда завёлся аккаунт. */
  created_at: string;
  /** Последний раз, когда с сессией этого человека пришёл запрос. `null` —
      активности ещё не видно. */
  last_active_at: string | null;
  /** Организации, в которых состоит человек. Пусто — вышел из всех,
      включая собственную, заведённую при регистрации. */
  organizations: string[];
};

/**
 * Все аккаунты установки — самые новые регистрации первыми.
 *
 * Доступен только адресам из ADMIN_EMAILS на сервере; остальным маршрут
 * отвечает 403 (см. `error.forbidden` в словаре).
 */
export function adminUsers(): Promise<AdminUser[]> {
  return request<AdminUser[]>("/api/admin/users");
}
