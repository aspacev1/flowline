import { ApiError } from "./client";

/**
 * Коды, у которых есть свой перевод. Список явный, а не «подставим код в
 * шаблон ключа»: неизвестный код тогда молча превращался бы в отсутствующий
 * ключ, и человек видел бы `auth.error.teapot` вместо внятного сообщения.
 */
const AUTH_CODES = new Set([
  "email_taken",
  "bad_credentials",
  "signup_disabled",
  "not_authenticated",
  "session_expired",
  "validation_error",
  "password_too_short",
]);

const PLAIN_CODES = new Set(["network", "no_organization", "forbidden"]);

/** Ключ словаря, которым объясняется ошибка. Сырой код наружу не выходит. */
export function errorKey(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "unknown";
  if (AUTH_CODES.has(code)) return `auth.error.${code}`;
  if (PLAIN_CODES.has(code)) return `error.${code}`;
  return "error.unknown";
}
