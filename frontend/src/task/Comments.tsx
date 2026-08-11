import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { commentsQueryKey, listTaskComments, postComment } from "../api/comments";
import { errorKey } from "../api/errors";
import { CommentThread } from "../comments/CommentThread";
import { useLocale } from "../i18n/LocaleProvider";
import { FieldRow } from "./fields";

/**
 * Обсуждение задачи.
 *
 * От старых к новым — так их отдаёт сервер, и переворачивать нить в браузере
 * значило бы держать порядок разговора в двух местах.
 *
 * Оптимистичной вставки здесь нет, в отличие от правки полей рядом. Разница не
 * в лени: у изменения задачи есть обратная операция, и отказ сервера
 * возвращает состояние назад бесследно. У реплики отката нет — показать её до
 * подтверждения значит однажды показать реплику, которой не существует, и
 * забрать её со экрана уже нечем.
 *
 * Отказ ленты ничего не ломает: блока просто нет, а карточка выше работает как
 * работала. Тот же довод, что и у истории задачи.
 */
export function Comments({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { t } = useLocale();
  const client = useQueryClient();
  const [draft, setDraft] = useState("");

  const thread = useQuery({
    queryKey: commentsQueryKey(projectId, taskId),
    queryFn: () => listTaskComments(projectId, taskId),
    retry: false,
  });

  const send = useMutation({
    mutationFn: (body: string) => postComment(projectId, taskId, body),
    onSuccess: () => {
      // Черновик стирается только после подтверждения: отказ — повод
      // исправить реплику, а не набрать её заново.
      setDraft("");
      client.invalidateQueries({ queryKey: commentsQueryKey(projectId, taskId) });
    },
  });

  if (thread.error) return null;

  return (
    // Подписанная секция — ориентир: карточка длинная, и обсуждение в её
    // конце должно находиться переходом по областям, а не прокруткой до
    // упора. Подписью служит собственный заголовок блока, а не его копия в
    // aria-label: копия однажды разойдётся с видимым текстом.
    <section className="panel__comments" aria-labelledby="panel-comments-title">
      <h3 id="panel-comments-title" className="panel__history-title">
        {t("comments.title")}
      </h3>

      <CommentThread comments={thread.data} />

      <form
        className="comments__form"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate(draft);
        }}
      >
        <FieldRow id="panel-comment" label={t("comments.field")}>
          <textarea
            id="panel-comment"
            rows={2}
            value={draft}
            disabled={send.isPending}
            onChange={(event) => setDraft(event.target.value)}
          />
        </FieldRow>

        {send.error !== null && (
          <p className="error" role="alert">
            {t(errorKey(send.error))}
          </p>
        )}

        <button type="submit" disabled={send.isPending}>
          {t("comments.submit")}
        </button>
      </form>
    </section>
  );
}
