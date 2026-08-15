import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errorKey } from "../api/errors";
import { getShare, issueShare, revokeShare, rotateShare, setShareComments } from "../api/share";
import type { Share } from "../api/share";
import { ConfirmAction } from "../components/ConfirmAction";
import { useLocale } from "../i18n/LocaleProvider";

const shareQueryKey = (projectId: string) => ["project", projectId, "share"] as const;

/**
 * Публичная ссылка на проект — в настройках проекта.
 *
 * Перевыпуск и отзыв названы разными кнопками, потому что это разные решения:
 * перевыпуск убивает прежнюю ссылку и даёт новую (её надо разослать заново),
 * отзыв закрывает проект наружу совсем. Одна кнопка «обновить» скрывала бы эту
 * разницу ровно до того момента, когда она станет важна.
 */
export function SharePanel({ projectId }: { projectId: string }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const key = shareQueryKey(projectId);

  const query = useQuery({ queryKey: key, queryFn: () => getShare(projectId), retry: false });
  const write = (share: Share | null) => queryClient.setQueryData(key, share);

  const issue = useMutation({ mutationFn: () => issueShare(projectId), onSuccess: write });
  // Перевыпуск ходит своим маршрутом, а не повторяет выпуск: на уже
  // опубликованном проекте POST /share отвечает 409 — сервер не превращает
  // повтор запроса в тихое убийство разосланной ссылки.
  const rotate = useMutation({ mutationFn: () => rotateShare(projectId), onSuccess: write });
  const comments = useMutation({
    mutationFn: (enabled: boolean) => setShareComments(projectId, enabled),
    onSuccess: write,
  });
  const revoke = useMutation({
    mutationFn: () => revokeShare(projectId),
    onSuccess: () => write(null),
  });

  const failure = issue.error ?? rotate.error ?? comments.error ?? revoke.error;
  const share = query.data ?? null;

  return (
    <section className="settings__fieldset">
      <h2>{t("share.title")}</h2>

      {failure != null && (
        <p className="error" role="alert">
          {t(errorKey(failure))}
        </p>
      )}

      {share === null ? (
        <>
          <p className="muted">{t("share.hidden")}</p>
          <button type="button" onClick={() => issue.mutate()} disabled={issue.isPending}>
            {t("share.publish")}
          </button>
        </>
      ) : (
        <>
          <p className="field">
            <label htmlFor="share-url">{t("share.url")}</label>
            <input id="share-url" name="share-url" readOnly value={share.url ?? ""} />
          </p>

          <p className="field field--inline">
            <input
              id="share-comments"
              name="share-comments"
              type="checkbox"
              checked={share.comments_enabled}
              onChange={(event) => comments.mutate(event.target.checked)}
            />
            <label htmlFor="share-comments">{t("share.comments")}</label>
          </p>

          {/* Обе кнопки спрашивают: «перевыпустить» звучит как обновление, а
              означает, что адрес, уже отправленный клиенту, перестанет
              открываться, — и сказать это надо в ответ на нажатие, а не
              подсказкой, которую читают до того, как решили. */}
          <div className="modal__actions">
            <ConfirmAction
              className="button--quiet"
              label={t("share.reissue")}
              warning={t("share.reissue_warning")}
              confirm={t("share.reissue_confirm")}
              onConfirm={() => rotate.mutate()}
              disabled={rotate.isPending}
            />
            <ConfirmAction
              className="button--quiet"
              label={t("share.revoke")}
              warning={t("share.revoke_warning")}
              confirm={t("share.revoke_confirm")}
              onConfirm={() => revoke.mutate()}
              disabled={revoke.isPending}
            />
          </div>
        </>
      )}
    </section>
  );
}
