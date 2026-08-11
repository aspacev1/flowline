import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errorKey } from "../api/errors";
import { issueShare, readShare, revokeShare, setShareComments } from "../api/public";
import type { Share } from "../api/public";
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

  const query = useQuery({ queryKey: key, queryFn: () => readShare(projectId), retry: false });
  const write = (share: Share | null) => queryClient.setQueryData(key, share);

  const issue = useMutation({ mutationFn: () => issueShare(projectId), onSuccess: write });
  const comments = useMutation({
    mutationFn: (enabled: boolean) => setShareComments(projectId, enabled),
    onSuccess: write,
  });
  const revoke = useMutation({
    mutationFn: () => revokeShare(projectId),
    onSuccess: () => write(null),
  });

  const failure = issue.error ?? comments.error ?? revoke.error;
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
            <input id="share-url" name="share-url" readOnly value={share.url} />
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

          <div className="modal__actions">
            <button
              type="button"
              className="button--quiet"
              onClick={() => issue.mutate()}
              disabled={issue.isPending}
            >
              {/* Прежняя ссылка умирает мгновенно — об этом сказано в самой
                  подписи, а не в подсказке где-то рядом. */}
              {t("share.reissue")}
            </button>
            <button
              type="button"
              className="button--quiet"
              onClick={() => revoke.mutate()}
              disabled={revoke.isPending}
            >
              {t("share.revoke")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
