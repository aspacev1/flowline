import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errorKey } from "../api/errors";
import {
  getShare,
  issueShare,
  revokeShare,
  rotateShare,
  setShareComments,
  shareQueryKey,
} from "../api/share";
import type { Share } from "../api/share";
import { useLocale } from "../i18n/LocaleProvider";

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
  const write = (next: Share | null) => queryClient.setQueryData(key, next);
  const share = query.data ?? null;

  const issue = useMutation({ mutationFn: () => issueShare(projectId), onSuccess: write });
  // Перевыпуск идёт отдельным маршрутом: POST /share на уже опубликованном
  // проекте отвечает 409 — тем и защищает разосланный адрес от ретрая.
  const rotate = useMutation({ mutationFn: () => rotateShare(projectId), onSuccess: write });
  const comments = useMutation({
    mutationFn: (enabled: boolean) => setShareComments(projectId, enabled),
    onSuccess: write,
  });
  const revoke = useMutation({
    mutationFn: () => revokeShare(projectId),
    // Ответ на DELETE пустой, поэтому состояние собирается здесь: ссылки
    // больше нет, но право публиковать осталось — иначе панель после отзыва
    // перестала бы отличать «закрыто владельцем» от «запрещено установкой».
    onSuccess: () => write(share === null ? null : { ...share, url: null, created_at: null }),
  });

  const failure = issue.error ?? rotate.error ?? comments.error ?? revoke.error;

  return (
    <section className="settings__fieldset">
      <h2>{t("share.title")}</h2>

      {failure != null && (
        <p className="error" role="alert">
          {t(errorKey(failure))}
        </p>
      )}

      {share?.allowed === false && <p className="muted">{t("share.disabled")}</p>}

      {/* «Опубликован» — это наличие адреса, а не наличие ответа: сервер
          отвечает и на неопубликованный проект, с `url: null`. */}
      {share === null || share.url === null ? (
        <>
          <p className="muted">{t("share.hidden")}</p>
          {/* Кнопка, которая кончится отказом, хуже её отсутствия: при
              запрещённых ссылках причина уже названа словами выше. */}
          {share?.allowed !== false && (
            <button type="button" onClick={() => issue.mutate()} disabled={issue.isPending}>
              {t("share.publish")}
            </button>
          )}
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
              onClick={() => rotate.mutate()}
              disabled={rotate.isPending}
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
