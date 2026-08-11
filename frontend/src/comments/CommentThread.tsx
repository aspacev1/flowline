import type { Comment } from "../api/comments";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";

import "./comments.css";

/**
 * Список реплик.
 *
 * Отдельно от формы, потому что вызывающих двое: карточка задачи под сессией и
 * публичная страница, где у формы есть ещё поле имени. Разметка самой реплики
 * при этом одна — иначе реплика гостя и реплика участника разошлись бы по
 * виду, хотя это одна и та же реплика.
 *
 * От старых к новым — так их отдаёт сервер, и переворачивать нить в браузере
 * значило бы держать порядок разговора в двух местах.
 */
export function CommentThread({ comments }: { comments: Comment[] | undefined }) {
  const { t } = useLocale();

  return (
    <>
      {comments && comments.length === 0 && <p className="muted">{t("comments.empty")}</p>}

      <ol className="comments__list">
        {comments?.map((comment) => (
          <li key={comment.id} className="comments__item">
            <p className="comments__meta">
              <span className="comments__author">{signature(comment, t)}</span>
              <span>{formatShortDate(t, comment.created_at.slice(0, 10))}</span>
            </p>
            {/* Текст человека: выводится как есть, без перевода. */}
            <p className="comments__body">{comment.body}</p>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * Подпись под репликой.
 *
 * Имя — содержимое пользователя и не переводится; пометка «гость» — чрома и
 * переводится. Поэтому они собираются шаблоном с подстановкой, а не склейкой
 * строк: в другом языке пометка встанет по другую сторону имени.
 */
function signature(
  comment: Comment,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  if (comment.author) return comment.author.name;
  return t("comments.guest", { name: comment.guest_name ?? "" });
}
