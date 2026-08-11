import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { errorKey } from "../api/errors";
import {
  addPublicComment,
  commentsQueryKey,
  publicComments,
  publicProject,
  publicProjectQueryKey,
} from "../api/public";
import type { CommentEntry } from "../api/public";
import { LocaleSwitch } from "../components/LocaleSwitch";
import { Gantt } from "../gantt/Gantt";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";

/** Имя гостя запоминается в браузере: спрашивать его при каждой реплике — грубо. */
const GUEST_NAME_KEY = "flowline.guest_name";

function storedName(): string {
  try {
    return localStorage.getItem(GUEST_NAME_KEY) ?? "";
  } catch {
    // Приватный режим умеет запрещать localStorage. Имя тогда просто не
    // запоминается между визитами — это не повод падать.
    return "";
  }
}

/**
 * Страница проекта по публичной ссылке.
 *
 * Та же раскладка, что и рабочий экран, но без инструментов редактирования и
 * без внутренних заметок — и то, и другое решает сервер: он не присылает
 * заметок, а диаграмма рисуется в режиме чтения.
 *
 * Переключатель языка в углу стоит потому, что клиент может не совпадать по
 * языку с командой, а профиля у него нет.
 */
export function PublicProject() {
  const { t } = useLocale();
  const [params] = useSearchParams();
  const token = params.get("s") ?? "";

  const query = useQuery({
    queryKey: publicProjectQueryKey(token),
    queryFn: () => publicProject(token),
    retry: false,
    enabled: token !== "",
  });

  if (token === "" || query.error) {
    return (
      <main className="screen">
        <p className="error" role="alert">
          {t(token === "" ? "error.share_not_found" : errorKey(query.error))}
        </p>
      </main>
    );
  }

  if (query.isPending) {
    return (
      <main className="screen">
        <p role="status">{t("common.loading")}</p>
      </main>
    );
  }

  const project = query.data;

  return (
    <main className="screen screen--wide">
      <div className="screen__head">
        <div>
          {/* Название проекта и организации — содержимое: не переводятся. */}
          <h1>{project.name}</h1>
          <p className="muted">{project.org_name}</p>
        </div>
        <LocaleSwitch />
      </div>

      {/* canWrite не передаётся вовсе: гость смотрит, но не трогает. */}
      <Gantt projectId={project.id} state={project} />

      <Comments token={token} enabled={project.comments_enabled} />
    </main>
  );
}

function Comments({ token, enabled }: { token: string; enabled: boolean }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [name, setName] = useState(storedName());
  const [body, setBody] = useState("");

  const query = useQuery({
    queryKey: commentsQueryKey(token),
    queryFn: () => publicComments(token),
    retry: false,
  });

  const post = useMutation({
    mutationFn: () => addPublicComment(token, { body: body.trim(), guest_name: name.trim() }),
    onSuccess: async () => {
      setBody("");
      try {
        localStorage.setItem(GUEST_NAME_KEY, name.trim());
      } catch {
        // см. storedName()
      }
      await queryClient.invalidateQueries({ queryKey: commentsQueryKey(token) });
    },
  });

  return (
    <section className="settings">
      <h2>{t("comments.title")}</h2>

      <ul className="members__list">
        {query.data?.map((comment: CommentEntry) => (
          <li key={comment.id} className="members__row">
            <span>
              {comment.author_name}
              {/* Реплики гостя отличаются от реплик участников с аккаунтом. */}
              {comment.is_guest && <span className="muted"> {t("comments.guest")}</span>}
            </span>
            <span>{comment.body}</span>
            <span className="muted">{formatShortDate(t, comment.created_at.slice(0, 10))}</span>
          </li>
        ))}
      </ul>

      {!enabled ? (
        <p className="muted">{t("comments.disabled")}</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            post.mutate();
          }}
        >
          <p className="field">
            <label htmlFor="guest-name">{t("comments.your_name")}</label>
            <input
              id="guest-name"
              name="guest-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </p>
          <p className="field">
            <label htmlFor="guest-comment">{t("comments.body")}</label>
            <textarea
              id="guest-comment"
              name="guest-comment"
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </p>
          {post.error !== null && (
            <p className="error" role="alert">
              {t(errorKey(post.error))}
            </p>
          )}
          <button
            type="submit"
            disabled={name.trim() === "" || body.trim() === "" || post.isPending}
          >
            {t("comments.send")}
          </button>
        </form>
      )}
    </section>
  );
}
