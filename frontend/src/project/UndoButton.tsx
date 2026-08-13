import type { ProjectState } from "../api/projects";
import { errorKey } from "../api/errors";
import { useLocale } from "../i18n/LocaleProvider";
import { formatEvent } from "../task/formatEvent";
import { useUndo } from "./useUndo";

/**
 * Кнопка «Отменить» в шапке проекта.
 *
 * Называет, что именно она отменит: «Отменить: перенёс старт с 12 на 19
 * марта». Безымянная кнопка отмены заставляет вспоминать, что было последним
 * действием, — а вспоминают неверно как раз тогда, когда торопятся исправить
 * ошибку.
 *
 * Сама механика — в useUndo: та же отмена доступна из ленты истории, и обе
 * кнопки обязаны делать строго одно и то же.
 */
export function UndoButton({ projectId, state }: { projectId: string; state: ProjectState }) {
  const { t, locale } = useLocale();
  const { undoable, mutation, error } = useUndo(projectId, state);

  if (!undoable) return null;

  const what = formatEvent(undoable.op, locale);

  return (
    <>
      <button
        type="button"
        className="button--quiet"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        title={what}
      >
        {undoable.batch_id ? t("undo.batch") : t("undo.last", { what })}
      </button>
      {error !== null && (
        <span className="error" role="alert">
          {t(errorKey(error))}
        </span>
      )}
    </>
  );
}
