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

export const ORGANIZATIONS_QUERY_KEY = ["org", "list"] as const;

/** Организация, в которой человек находится сейчас. */
export function organization(): Promise<Organization> {
  return request<Organization>("/api/org");
}

/**
 * Организации, в которых человек состоит, — содержимое переключателя.
 *
 * Приходит и тогда, когда организация одна: решать, показывать ли
 * переключатель, — дело интерфейса, а не сервера.
 */
export function organizations(): Promise<Organization[]> {
  return request<Organization[]>("/api/org/list");
}

/**
 * Переключает сессию на другую организацию.
 *
 * Выбор живёт на сессии, а не на странице: после перезагрузки человек
 * остаётся там, где работал, а не возвращается в свою организацию.
 */
export function switchOrganization(orgId: string): Promise<Organization> {
  return request<Organization>("/api/org/switch", {
    method: "POST",
    body: JSON.stringify({ org_id: orgId }),
  });
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
