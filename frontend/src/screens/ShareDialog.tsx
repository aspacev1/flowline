import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import {
  getShare,
  issueShare,
  revokeShare,
  setShareComments,
  shareQueryKey,
} from "../api/share";
import { Modal } from "../components/Modal";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Публичная ссылка проекта: выпустить, скопировать, перевыпустить, закрыть.
 *
 * Адрес приходит с сервера целиком и здесь не собирается: домен установки
 * знает только он (`PUBLIC_BASE_URL`), а браузер, собравший ссылку из своего
 * `location.origin`, ошибётся ровно там, где это заметят позже всего — в
 * ссылке, уже отправленной клиенту.
 */
export function ShareDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const share = useQuery({
    queryKey: shareQueryKey(projectId),
    queryFn: () => getShare(projectId),
    retry: false,
  });

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: shareQueryKey(projectId) });
  }

  const issue = useMutation({
    mutationFn: () => issueShare(projectId),
    onSuccess: () => {
      setCopied(false);
      return refresh();
    },
  });

  const comments = useMutation({
    mutationFn: (enabled: boolean) => setShareComments(projectId, enabled),
    onSuccess: refresh,
  });

  const revoke = useMutation({
    mutationFn: () => revokeShare(projectId),
    onSuccess: () => {
      setCopied(false);
      return refresh();
    },
  });

  const failure = share.error ?? issue.error ?? comments.error ?? revoke.error;
  const busy = issue.isPending || comments.isPending || revoke.isPending;
  const url = share.data?.url ?? null;

  async function copy() {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Буфер обмена доступен не всегда: без https и без разрешения браузер
      // отказывает. Адрес при этом виден в поле и выделяется руками —
      // поэтому отказ не показывается ошибкой, он ничего не сломал.
      setCopied(false);
    }
  }

  return (
    <Modal title={t("share.title")} onClose={onClose}>
      {share.isPending && <p role="status">{t("common.loading")}</p>}

      {failure !== undefined && failure !== null && (
        <p className="error" role="alert">
          {t(errorKey(failure))}
        </p>
      )}

      {share.data?.allowed === false && <p className="muted">{t("share.disabled")}</p>}

      {share.data?.allowed && url === null && (
        <>
          <p className="muted">{t("share.hint")}</p>
          <div className="modal__actions">
            <button type="button" onClick={() => issue.mutate()} disabled={busy}>
              {t("share.publish")}
            </button>
            <button type="button" className="button--quiet" onClick={onClose}>
              {t("common.cancel")}
            </button>
          </div>
        </>
      )}

      {share.data?.allowed && url !== null && (
        <>
          <p className="field">
            <label htmlFor="share-url">{t("share.url")}</label>
            <input id="share-url" name="share-url" readOnly value={url} />
          </p>

          <p className="checkbox">
            <input
              id="share-comments"
              name="share-comments"
              type="checkbox"
              checked={share.data.comments_enabled}
              disabled={busy}
              onChange={(event) => comments.mutate(event.target.checked)}
            />
            <label htmlFor="share-comments">{t("share.comments_enabled")}</label>
          </p>

          {/* Предупреждение стоит рядом с кнопкой, а не в подсказке сверху:
              «перевыпустить» звучит безобидно, а означает, что уже
              отправленная клиенту ссылка перестанет открываться. */}
          <p className="muted">{t("share.reissue_warning")}</p>

          <div className="modal__actions">
            <button type="button" onClick={() => void copy()} disabled={busy}>
              {copied ? t("share.copied") : t("share.copy")}
            </button>
            <button
              type="button"
              className="button--quiet"
              onClick={() => issue.mutate()}
              disabled={busy}
            >
              {t("share.reissue")}
            </button>
            <button
              type="button"
              className="button--quiet"
              onClick={() => revoke.mutate()}
              disabled={busy}
            >
              {t("share.revoke")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
