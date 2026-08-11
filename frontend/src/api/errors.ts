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
  "nothing_to_undo",
  "batch_not_found",
  "slug_taken",
  "unsupported_locale",
  // Приглашения. Просроченное, отозванное и уже принятое — три разных кода и
  // три разных сообщения: человек должен понимать, просить ли новую ссылку
  // или он уже в системе и достаточно войти.
  "invite_not_found",
  "invite_expired",
  "invite_revoked",
  "invite_accepted",
  "invite_for_another_address",
  "invite_rate_limited",
  "email_not_verified",
  "role_not_invitable",
  "verification_not_found",
  // Публичный доступ и комментарии.
  "share_not_found",
  "comments_disabled",
  "guest_name_required",
  "comment_rate_limited",
  "public_sharing_disabled",
  // AI. Сбой модели — состояние, о котором человеку говорят словами:
  // переписка и черновик при этом сохраняются.
  "llm_not_configured",
  "llm_unreachable",
  "llm_refused",
  "llm_schema_mismatch",
  "llm_bad_json",
  "llm_bad_shape",
  "llm_key_unreadable",
  "llm_failed",
  "api_key_required",
  "wrong_step",
  "already_applied",
  "ai_session_not_found",
  "interview_exhausted",
  "nothing_asked",
  // Обычно этот отказ не доходит до человека: интерфейс спрашивает причину и
  // повторяет операцию. Перевод нужен для того случая, когда спросить негде —
  // например, окно закрыли до ответа сервера.
  "reason_required",
]);

/** Ключ словаря, которым объясняется ошибка. Сырой код наружу не выходит. */
export function errorKey(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "unknown";
  if (AUTH_CODES.has(code)) return `auth.error.${code}`;
  if (PLAIN_CODES.has(code)) return `error.${code}`;
  return "error.unknown";
}
