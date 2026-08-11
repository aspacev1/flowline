import { useState } from "react";

import type { Comment } from "../api/comments";
import { errorKey } from "../api/errors";
import { Field } from "../components/Field";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { rememberGuestName, storedGuestName } from "./guestName";

import "./comments.css";

/**
 * Лента реплик и форма ответа — одна и та же на рабочем экране и на публичной
 * странице.
 *
 * Разница между участником и гостем ровно одна: гость подписывается именем,
 * которое вводит сам. Держать ради этого две ленты значило бы поддерживать
 * два способа показать один и тот же разговор — и однажды они разойдутся на
 * той самой пометке «гость», ради которой всё и затевалось.
 */
export function CommentThread({
  comments,
  loading = false,
  error,
  askName = false,
  canComment = true,
  onSend,
  sending = false,
  sendError,
}: {
  comments: Comment[];
  loading?: boolean;
  error?: unknown;
  /** Спрашивать ли имя: у гостя аккаунта нет, и подписаться ему нечем. */
  askName?: boolean;
  /** Выключенные комментарии закрывают форму, но не саму ленту. */
  canComment?: boolean;
  onSend: (input: { body: string; name: string }) => void;
  sending?: boolean;
  sendError?: unknown;
}) {
  const { t } = useLocale();
  const [body, setBody] = useState("");
  // Имя подтягивается из браузера сразу: гость, уже назвавшийся однажды,
  // не должен вводить его снова под каждой репликой.
  const [name, setName] = useState(() => (askName ? storedGuestName() : ""));

  const trimmedBody = body.trim();
  const trimmedName = name.trim();
  const ready = trimmedBody !== "" && (!askName || trimmedName !== "");

  return (
    <section className="comments" aria-label={t("comments.title")}>
      <h2 className="comments__title">{t("comments.title")}</h2>

      {loading && <p role="status">{t("common.loading")}</p>}

      {error !== undefined && error !== null && (
        <p className="error" role="alert">
          {t(errorKey(error))}
        </p>
      )}

      {!loading && comments.length === 0 && <p className="muted">{t("comments.empty")}</p>}

      <ol className="comments__list">
        {comments.map((comment) => (
          <li key={comment.id} className="comment">
            <p className="comment__head">
              {/* Имя автора — содержимое пользователя: не переводится ни при
                  каком языке интерфейса. */}
              <span className="comment__author">{comment.author.name}</span>
              {comment.author.guest && (
                <span className="comment__guest">{t("comments.guest")}</span>
              )}
              <span className="muted">{formatShortDate(t, comment.created_at)}</span>
            </p>
            <p className="comment__body">{comment.body}</p>
          </li>
        ))}
      </ol>

      {canComment ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            if (askName) rememberGuestName(trimmedName);
            onSend({ body: trimmedBody, name: trimmedName });
            setBody("");
          }}
        >
          {askName && (
            <Field
              id="comment-name"
              label={t("comments.your_name")}
              value={name}
              onChange={setName}
              autoComplete="nickname"
            />
          )}

          <p className="field">
            <label htmlFor="comment-body">{t("comments.body")}</label>
            <textarea
              id="comment-body"
              name="comment-body"
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </p>

          {sendError !== undefined && sendError !== null && (
            <p className="error" role="alert">
              {t(errorKey(sendError))}
            </p>
          )}

          <button type="submit" disabled={!ready || sending}>
            {t("comments.send")}
          </button>
        </form>
      ) : (
        // Не пустота на месте формы: выключенные комментарии — это решение
        // владельца, и человек должен прочитать его словами, а не гадать,
        // куда делось поле ввода.
        <p className="muted">{t("comments.closed")}</p>
      )}
    </section>
  );
}
