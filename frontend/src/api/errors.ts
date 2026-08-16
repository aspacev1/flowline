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
  "invalid_token",
  "token_expired",
  "already_verified",
  "too_many_requests",
]);

const PLAIN_CODES = new Set([
  "network",
  // Отказ, придуманный клиентом, а не сервером: при оборванной связи изменение
  // не отправляется вовсе. Живёт в общем списке, потому что показывается тем же
  // способом, что и отказ сервера, — человеку разницы нет.
  "offline",
  "no_organization",
  "forbidden",
  "project_not_found",
  // Отказы домена. Список явный по той же причине, что и у кодов входа:
  // подстановка кода в шаблон ключа превратила бы незнакомый код в
  // отсутствующий перевод, и человек прочитал бы `task_limit_reached`.
  "category_not_found",
  "task_not_found",
  // Смета. Три отказа, как у плана: чужая или несуществующая сущность и
  // пустое предложение, которому нечего переносить в план.
  "proposal_category_not_found",
  "proposal_task_not_found",
  "proposal_empty",
  "task_limit_reached",
  "duration_too_short",
  "user_not_in_organization",
  "calendar_has_no_working_days",
  "calendar_too_few_working_days",
  "progress_out_of_range",
  "unknown_criticality",
  // Связи. До перетаскивания стрелок эти отказы были почти недостижимы —
  // список в карточке не показывал ни себя, ни уже связанные задачи. Кружок на
  // краю полоски не разбирает, куда его тянут, и «кольцо» стало обычным
  // ответом: человек видит две полоски, а не весь граф.
  "self_dependency",
  "dependency_exists",
  "dependency_cycle",
  "dependency_not_found",
  // Вехи и сдвиг категории.
  "milestone_has_duration",
  "task_is_milestone",
  "empty_shift",
  "category_empty",
  "date_out_of_range",
  "already_assigned",
  "assignment_not_found",
  "negative_position",
  "nothing_to_undo",
  // Отменять просят не то, что лежит наверху журнала: пока человек читал тост,
  // верх уехал. Отказ доходит до человека редко — кнопка к этому времени
  // обычно уже погашена, — но гонку между взглядом на кэш и ответом сервера
  // закрывает именно он.
  "undo_conflict",
  "batch_not_found",
  "slug_taken",
  "slug_empty",
  "unsupported_locale",
  // Приглашения. Просроченное, отозванное и уже принятое — три разных кода и
  // три разных сообщения: человек должен понимать, просить ли новую ссылку
  // или он уже в системе и достаточно войти.
  // Публичный доступ и комментарии.
  "link_not_found",
  "sharing_disabled",
  "share_link_not_found",
  "comments_closed",
  "comment_empty",
  "comment_too_long",
  "guest_name_required",
  "too_many_comments",
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
  "invite_for_another_address",
  "invite_rate_limited",
  "email_not_verified",
  "role_not_invitable",
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
