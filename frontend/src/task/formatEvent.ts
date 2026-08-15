import { relativeDayLabel } from "../gantt/relative";
import { formatShortDate } from "../i18n/dates";
import { translate } from "../i18n";
import type { Locale, Params } from "../i18n";

/**
 * Запись журнала → фраза на языке читателя.
 *
 * Здесь окупается решение хранить событие параметрами, а не готовым текстом:
 * один и тот же перенос читается на трёх языках, и язык выбирает тот, кто
 * смотрит, — а не тот, кто когда-то нажал кнопку.
 *
 * Причина сдвига через эту функцию не проходит вовсе: это текст пользователя,
 * и переводить его нечем и не нужно. Её показывает лента, как есть.
 */

/** Поля, которые карточка сохраняет одной операцией. Порядок — как в карточке. */
const TEXT_FIELDS = ["name", "description", "internal_note"] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function formatEvent(
  op: Record<string, unknown>,
  locale: Locale,
  /**
   * Имена сущностей по идентификатору — как их отдаёт журнал. Позволяют
   * назвать исполнителя и концы связи; без словаря фраза остаётся безымянной,
   * как и была, — запись старого формата не ломает ленту.
   */
  names: Record<string, string> = {},
  /**
   * Читать ли даты как дни относительной оси. Журнал хранит координаты, и у
   * относительного проекта «переносом с 3 января» была бы выдача внутренней
   * системы координат за настоящую дату.
   */
  relative = false,
): string {
  const t = (key: string, params?: Params) => translate(locale, key, params);
  const say = (key: string, params?: Params) => t(`history.${key}`, params);
  const day = (iso: string) => (relative ? relativeDayLabel(t, iso) : formatShortDate(t, iso));

  switch (op.type) {
    case "move_task":
      return say("move_task", {
        from: day(String(op.from)),
        to: day(String(op.to)),
      });

    case "set_duration":
      // Через common.days, а не «{n} дней»: русский различает три формы, и
      // «21 дней» в ленте истории читается как опечатка приложения.
      return say("set_duration", {
        from: t("common.days", { count: Number(op.from) }),
        to: t("common.days", { count: Number(op.to) }),
      });

    case "set_progress":
      return say("set_progress", { from: Number(op.from), to: Number(op.to) });

    case "set_criticality":
      return say("set_criticality", {
        from: t(`task.criticality.${String(op.from)}`),
        to: t(`task.criticality.${String(op.to)}`),
      });

    case "set_status":
      return say("set_status", {
        from: t(`task.status.${String(op.from)}`),
        to: t(`task.status.${String(op.to)}`),
      });

    case "set_task_fields": {
      const before = asRecord(op.from);
      const after = asRecord(op.to);
      // Только изменившиеся: операция несёт все три поля разом, и «изменил
      // название, описание и заметку» после правки одного описания — неправда.
      // Заметки может не быть ни в одной из границ: роль, которая её не видит,
      // получает запись без неё, и упоминать её тогда нечем.
      const changed = TEXT_FIELDS.filter(
        (field) => field in after && before[field] !== after[field],
      );
      if (changed.length === 0) return say("unknown");
      return say("set_task_fields", {
        fields: changed.map((field) => say(`field.${field}`)).join(", "),
      });
    }

    case "create_task":
      return say("create_task");
    case "delete_task":
      return say("delete_task");
    case "reorder_task":
      return say("reorder_task");
    case "assign_user":
    case "unassign_user": {
      // Имя — содержимое, а не хрома: подставляется как есть. Безымянная
      // форма остаётся для записей, чей исполнитель стёр аккаунт.
      const name = names[String(op.user_id)];
      return name ? say(`${String(op.type)}_named`, { name }) : say(String(op.type));
    }
    case "add_dependency":
    case "remove_dependency": {
      const from = names[String(op.from_task_id)];
      const to = names[String(op.to_task_id)];
      return from && to
        ? say(`${String(op.type)}_named`, { from, to })
        : say(String(op.type));
    }
    case "create_category":
      return say("create_category");
    case "delete_category":
      return say("delete_category");
    case "rename_category":
      return say("rename_category", { from: String(op.from), to: String(op.to) });
    case "set_category_color":
      return say("set_category_color");

    default:
      // Журнал переживёт версии приложения: запись, сделанную новой версией,
      // старая вкладка обязана показать, а не уронить карточку целиком.
      return say("unknown");
  }
}
