import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { errorKey } from "../api/errors";
import {
  addPublicComment,
  getPublicProject,
  listPublicCommentCounts,
  listPublicComments,
  publicCommentCountsQueryKey,
  publicCommentsQueryKey,
  publicProjectQueryKey,
} from "../api/public";
import { CommentThread } from "../comments/CommentThread";
import { LocaleSwitch } from "../components/LocaleSwitch";
import { Gantt } from "../gantt/Gantt";
import { usePrefersReducedMotion } from "../gantt/motion";
import { useLocale } from "../i18n/LocaleProvider";
import { ProjectHead } from "../project/ProjectHead";

/**
 * Проект, открытый по публичной ссылке.
 *
 * Та же диаграмма, что и на рабочем экране, но только на чтение: `canWrite`
 * здесь не выключен «пока что», его неоткуда взять — у гостя нет ни сессии,
 * ни роли. Внутренних заметок и исполнителей в ответе сервера нет вовсе, и
 * прятать их разметке не приходится.
 *
 * Переключатель языка стоит прямо на странице: клиент может не совпадать по
 * языку с командой, а профиля, из которого можно было бы взять язык, у него
 * нет.
 */
export function PublicProject() {
  const { t } = useLocale();
  const { orgSlug = "", projectSlug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("s") ?? "";
  const queryClient = useQueryClient();
  const reducedMotion = usePrefersReducedMotion();

  const project = useQuery({
    queryKey: publicProjectQueryKey(orgSlug, projectSlug, token),
    queryFn: () => getPublicProject(orgSlug, projectSlug, token),
    retry: false,
  });

  const comments = useQuery({
    queryKey: publicCommentsQueryKey(orgSlug, projectSlug, token),
    queryFn: () => listPublicComments(orgSlug, projectSlug, token),
    retry: false,
    // Лента спрашивается только тогда, когда страница открылась: до этого
    // токен может оказаться нерабочим, и второй запрос принесёт вторую
    // ошибку об одном и том же.
    enabled: project.isSuccess,
  });

  // Число реплик на строках — без внутренних: их фильтрует сервер, а не
  // разметка. Ключ лежит внутри ключа ленты, поэтому своя же отправленная
  // реплика обновляет и счётчик — тем же сбросом, что и саму ленту.
  const counts = useQuery({
    queryKey: publicCommentCountsQueryKey(orgSlug, projectSlug, token),
    queryFn: () => listPublicCommentCounts(orgSlug, projectSlug, token),
    retry: false,
    enabled: project.isSuccess,
  });
  const commentsByTask = useMemo(
    () => new Map(Object.entries(counts.data ?? {})),
    [counts.data],
  );

  const send = useMutation({
    mutationFn: (input: { body: string; name: string }) =>
      addPublicComment(orgSlug, projectSlug, token, { name: input.name, body: input.body }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: publicCommentsQueryKey(orgSlug, projectSlug, token),
      }),
  });

  if (project.isPending) {
    return (
      <main className="screen screen--center">
        <p role="status">{t("common.loading")}</p>
      </main>
    );
  }

  if (project.error) {
    // Отозванная ссылка, опечатка в адресе и несуществующий проект приходят
    // одним и тем же отказом: сервер их не различает сознательно, и
    // придумывать здесь разницу нельзя.
    return (
      <main className="screen screen--center">
        <p className="error" role="alert">
          {t(errorKey(project.error))}
        </p>
      </main>
    );
  }

  return (
    <>
      <header className="header">
        <span className="header__brand">{project.data.org.name}</span>
        <div className="header__side">
          <span className="muted">{t("public.badge")}</span>
          <LocaleSwitch />
        </div>
      </header>

      <main className="screen screen--wide">
        {/* Та же шапка, что и на рабочем экране, но без действий и без строки
            плана: клиенту по ссылке обещаны сроки и объём, а не версия
            согласования и внутренние расхождения с ней. */}
        <ProjectHead state={project.data} />

        <div className={`project__body${reducedMotion ? " motion-off" : ""}`}>
          {/* Счётчик реплик виден и гостю — но кнопкой не становится:
              карточки задачи у него нет, и открывать ею нечего (см. Row).
              Знать, что об этой строке уже говорили, ему всё равно полезно:
              разговор идёт лентой ниже. */}
          <Gantt
            projectId={project.data.id}
            state={project.data}
            canWrite={false}
            commentCounts={commentsByTask}
          />
        </div>

        <CommentThread
          comments={comments.data ?? []}
          loading={comments.isPending}
          error={comments.error}
          askName
          canComment={project.data.comments_enabled}
          onSend={(input) => send.mutateAsync(input)}
          sending={send.isPending}
          sendError={send.error}
        />
      </main>
    </>
  );
}
