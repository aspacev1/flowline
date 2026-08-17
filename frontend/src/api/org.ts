import { request } from "./client";

export const ORG_QUERY_KEY = ["org"] as const;

/** Дефолты организации — те самые, которые наследуют проекты. */
export type OrganizationSettings = {
  default_locale: string;
  default_timezone: string;
  /** Битовая маска, где бит 0 — понедельник: так её считает сервер. */
  working_days: number;
  week_start: number;
  holiday_calendar: string[];
  default_shift_threshold_days: number;
  public_sharing_enabled: boolean;
  default_comments_enabled: boolean;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  role: string;
  settings: OrganizationSettings;
};

/** Ответ поля ввода слага: во что превратится введённое и что делать, если занято. */
export type SlugCheck = {
  normalized: string;
  available: boolean;
  suggestion: string;
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

/**
 * Правка настроек организации.
 *
 * Присылаются только изменённые поля: сервер отличает «не прислали» от
 * «прислали null», и отправлять всю форму целиком значило бы затирать чужие
 * правки, сделанные между открытием экрана и нажатием кнопки.
 */
export function updateOrganization(
  patch: Partial<OrganizationSettings & { name: string; slug: string }>,
): Promise<Organization> {
  return request<Organization>("/api/org", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function checkOrgSlug(slug: string): Promise<SlugCheck> {
  return request<SlugCheck>(`/api/org/slug-check?slug=${encodeURIComponent(slug)}`);
}

/**
 * Меняет роль участника. Правит владелец, и только он.
 *
 * Владельца назначают именно отсюда, а не приглашением: приглашение без адреса
 * достаётся предъявителю, и владельцем становился бы всякий, кто открыл
 * переславшуюся ссылку. Здесь адресат назван поимённо.
 *
 * Последнего владельца разжаловать нельзя — сервер отвечает `last_owner`.
 * Организация без владельца не разжалована, а заперта: назначить нового в ней
 * больше нечем.
 */
export function updateMemberRole(userId: string, role: string): Promise<Member> {
  return request<Member>(`/api/org/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

/**
 * Выводит человека из организации — или выпускает его самого.
 *
 * Один маршрут на оба действия: членства в обоих случаях больше нет, и
 * разными их делает только то, кто вправе его выполнить — владелец над любым
 * или человек над собой. Отсюда и «Покинуть организацию»: это тот же вызов со
 * своим собственным идентификатором.
 */
export function removeMember(userId: string): Promise<void> {
  return request<void>(`/api/org/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
}
