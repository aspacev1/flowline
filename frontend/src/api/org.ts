import { request } from "./client";

export const ORG_QUERY_KEY = ["org"] as const;

export type Organization = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export const MEMBERS_QUERY_KEY = ["org", "members"] as const;

export type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/** Организация, в которой человек находится сейчас. */
export function organization(): Promise<Organization> {
  return request<Organization>("/api/org");
}

/**
 * Люди, которых можно назначить исполнителями.
 *
 * Роль `client` этот маршрут не получает вовсе и видит 403. Это не поломка:
 * вызывающий обязан пережить отказ, спрятав выбор исполнителей, а не
 * показывать ошибку в форме, к которой она не относится.
 */
export function members(): Promise<Member[]> {
  return request<Member[]>("/api/org/members");
}
