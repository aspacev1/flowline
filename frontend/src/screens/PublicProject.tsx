import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { errorKey } from "../api/errors";
import {
  getPublicProject,
  listPublicComments,
  postPublicComment,
  publicCommentsKey,
  publicProjectKey,
} from "../api/public";
import { CommentThread } from "../comments/CommentThread";
import { LocaleSwitch } from "../components/LocaleSwitch";
import { Gantt } from "../gantt/Gantt";
import { useLocale } from "../i18n/LocaleProvider";
import { rememberGuestName, rememberedGuestName } from "../public/guestName";

/**
 * Публичная страница проекта.
 *
 * Лежит вне RequireAuth: у гостя сессии нет, и проверять её значило бы
 * отправить его на вход вместо проекта, который ему прислали. Шапки
 * приложения тоже нет — «Выйти» гостю предлагать неоткуда; вместо неё
 * название проекта и переключатель языка.
 *
 * Диаграмма только на чтение и без карточки задачи. Внутренних заметок в
 * разметке нет не потому, что их спрятали: сервер их не присылает, и брать их
 * здесь неоткуда.
 */
export function PublicProject() {
  const { t } = useLocale();
  const { orgSlug = "", projectSlug = "" } = useParams();

  const query = useQuery({
    queryKey: publicProjectKey(orgSlug, projectSlug),
    queryFn: () => getPublicProject(orgSlug, projectSlug),
    retry: false,
  });

  if (query.isPending) {
    return (
      <main className="screen">
        <p role="status">{t("common.loading")}</p>
      </main>
    );
  }

  // Отозванная ссылка, переименованный слаг и опечатка в адресе отвечают
  // одинаково — так решил сервер. Значит и объяснение одно: не «не найдено»,
  // а «ссылка больше не действует», потому что гость пришёл по ссылке, а не
  // набрал адрес руками.
  if (query.error) {
    return (
      <main className="screen">
        <p className="error" role="alert">
          {t("public.revoked")}
        </p>
        <p className="muted">{t("public.revoked_hint")}</p>
      </main>
    );
  }

  const state = query.data;

  return (
    <>
      <header className="header">
        {/* Название проекта — содержимое пользователя: не переводится. */}
        <span className="header__brand">{state.name}</span>
        <div className="header__side">
          <LocaleSwitch />
        </div>
      </header>

      <main className="screen screen--wide">
        <div className="project__body">
          {/* Ни onSelectTask, ни onAddTask: карточки задачи на публичной
              странице нет, и полоска, которая никуда не ведёт, не должна
              выглядеть нажимаемой. */}
          <Gantt projectId={state.id} state={state} canWrite={false} />
        </div>

        {state.comments_enabled && (
          <GuestThread orgSlug={orgSlug} projectSlug={projectSlug} />
        )}
      </main>
    </>
  );
}

/**
 * Обсуждение проекта целиком.
 *
 * Ветка проекта, а не задачи: карточки задачи здесь нет, и лента отдельной
 * строки гостю не отдаётся вовсе.
 *
 * Имя спрашивается один раз и запоминается браузером. Поле имени показывается,
 * только пока имя не запомнено: спрашивать его перед каждой репликой значит
 * заставлять человека представляться в собственном разговоре.
 */
function GuestThread({ orgSlug, projectSlug }: { orgSlug: string; projectSlug: string }) {
  const { t } = useLocale();
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const [name, setName] = useState(rememberedGuestName);
  const known = rememberedGuestName() !== "";

  const thread = useQuery({
    queryKey: publicCommentsKey(orgSlug, projectSlug),
    queryFn: () => listPublicComments(orgSlug, projectSlug),
    retry: false,
  });

  const send = useMutation({
    mutationFn: () => postPublicComment(orgSlug, projectSlug, draft, name.trim()),
    onSuccess: () => {
      // Имя запоминается только после того, как сервер принял реплику: иначе
      // отвергнутое имя осталось бы в браузере навсегда.
      rememberGuestName(name.trim());
      setDraft("");
      client.invalidateQueries({ queryKey: publicCommentsKey(orgSlug, projectSlug) });
    },
  });

  if (thread.error) return null;

  return (
    <section className="public__comments" aria-labelledby="public-comments-title">
      <h2 id="public-comments-title">{t("comments.title")}</h2>

      <CommentThread comments={thread.data} />

      <form
        className="comments__form"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate();
        }}
      >
        {!known && (
          <p className="field">
            <label htmlFor="public-guest-name">{t("public.guest_name")}</label>
            <input
              id="public-guest-name"
              type="text"
              value={name}
              disabled={send.isPending}
              onChange={(event) => setName(event.target.value)}
            />
          </p>
        )}

        <p className="field">
          <label htmlFor="public-comment">{t("comments.field")}</label>
          <textarea
            id="public-comment"
            rows={3}
            value={draft}
            disabled={send.isPending}
            onChange={(event) => setDraft(event.target.value)}
          />
        </p>

        {send.error !== null && (
          <p className="error" role="alert">
            {t(errorKey(send.error))}
          </p>
        )}

        <button type="submit" disabled={send.isPending || name.trim() === ""}>
          {t("comments.submit")}
        </button>
      </form>
    </section>
  );
}
