import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { addComment, commentsQueryKey, listComments } from "../api/comments";
import { CommentThread } from "../comments/CommentThread";

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
  const client = useQueryClient();

  const thread = useQuery({
    queryKey: commentsQueryKey(projectId, taskId),
    queryFn: () => listComments(projectId, taskId),
    retry: false,
  });

  const send = useMutation({
    mutationFn: (body: string) => addComment(projectId, body, taskId),
    onSuccess: () => {
      // И лента задачи, и лента проекта: реплика попала в обе, и обновить
      // только ту, что на глазах, значит оставить вторую врать до перехода.
      client.invalidateQueries({ queryKey: commentsQueryKey(projectId) });
    },
  });

  if (thread.error) return null;

  return (
    <div className="panel__comments">
      <CommentThread
        comments={thread.data ?? []}
        loading={thread.isPending}
        onSend={(input) => send.mutateAsync(input.body)}
        sending={send.isPending}
        sendError={send.error}
      />
    </div>
  );
}
