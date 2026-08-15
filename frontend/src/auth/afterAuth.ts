import type { Location } from "react-router-dom";

/** Куда вести человека, когда возвращаться некуда. */
export const AFTER_AUTH_FALLBACK = "/projects";

/**
 * Адрес, ради которого человека и отправили на вход.
 *
 * `RequireAuth` кладёт исходный адрес в состояние перехода, а экраны входа и
 * регистрации возвращают человека именно туда. Без этого присланная ссылка на
 * проект превращается после входа в общий список — то есть теряется ровно то,
 * зачем по ссылке шли, а это первый же экран нового участника.
 *
 * Состояние истории заводим не только мы: любая страница того же
 * происхождения может положить туда что угодно через `history.pushState`.
 * Поэтому берём лишь внутренний путь: `//example.com` браузер прочитал бы как
 * переход на чужой сайт, а возврат на сам вход замкнул бы человека в кольцо —
 * он вводит пароль и снова видит форму пароля.
 */
export function afterAuthPath(state: unknown): string {
  const from = (state as { from?: unknown } | null | undefined)?.from;
  if (from === null || typeof from !== "object") return AFTER_AUTH_FALLBACK;

  const { pathname, search, hash } = from as Partial<Location>;
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//")) {
    return AFTER_AUTH_FALLBACK;
  }
  if (pathname === "/login" || pathname === "/register") return AFTER_AUTH_FALLBACK;

  return `${pathname}${typeof search === "string" ? search : ""}${typeof hash === "string" ? hash : ""}`;
}
