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

const PLAIN_CODES = new Set([
  "network",
  "no_organization",
  "forbidden",
  "project_not_found",
  // Отказы домена. Список явный по той же причине, что и у кодов входа:
  // подстановка кода в шаблон ключа превратила бы незнакомый код в
  // отсутствующий перевод, и человек прочитал бы `task_limit_reached`.
  "category_not_found",
  "task_not_found",
  "task_limit_reached",
  "duration_too_short",
  "category_not_empty",
  "user_not_in_organization",
  "calendar_has_no_working_days",
  "calendar_too_few_working_days",
  "progress_out_of_range",
  "unknown_criticality",
  "already_assigned",
  "assignment_not_found",
  "negative_position",
  // Приглашения. Три состояния мёртвой ссылки названы порознь, а не одним
  // «ссылка недействительна»: по «просрочено» человек просит новую, по
  // «принято» просто входит, по «отозвано» идёт к тому, кто звал.
  "invite_not_found",
  "invite_expired",
  "invite_revoked",
  "invite_accepted",
  "invite_wrong_email",
  "invite_rate_limited",
  "invalid_email",
  "unknown_role",
  "project_ids_need_client_role",
  "organization_not_found",
  // Отказы почты. Отдельный код у каждого: «письмо не ушло» и «почта в этой
  // установке не настроена» чинятся разными людьми.
  "mail_failed",
  "mail_not_configured",
  "mail_disabled",
]);

/** Ключ словаря, которым объясняется ошибка. Сырой код наружу не выходит. */
export function errorKey(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "unknown";
  if (AUTH_CODES.has(code)) return `auth.error.${code}`;
  if (PLAIN_CODES.has(code)) return `error.${code}`;
  return "error.unknown";
}
