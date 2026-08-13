import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { addComment, commentsQueryKey, listComments } from "../api/comments";
import { errorKey } from "../api/errors";
import { getProject, projectQueryKey } from "../api/projects";
import { useCanWrite, useOrgRole } from "../auth/permissions";
import { CommentThread } from "../comments/CommentThread";
import { Menu } from "../components/Menu";
import { Gantt } from "../gantt/Gantt";
import { usePrefersReducedMotion } from "../gantt/motion";
import { useLocale } from "../i18n/LocaleProvider";
import { LiveProvider } from "../live/LiveProvider";
import { OfflineBar } from "../live/OfflineBar";
import { useProjectLive } from "../live/useProjectLive";
import { DependencyNudge, DependencyNudgeProvider } from "../project/DependencyNudge";
import { PlanApproval } from "../project/PlanApproval";
import { ProjectHead } from "../project/ProjectHead";
import { ShiftReasonProvider } from "../project/ShiftReason";
import { UndoButton } from "../project/UndoButton";
import { TaskPanel } from "../task/TaskPanel";
import { CategoryForm, suggestColor } from "./CategoryForm";
import { ShareDialog } from "./ShareDialog";
import { TaskForm } from "./TaskForm";

/**
 * Экран одного проекта.
 *
 * Три явных состояния, а не два: пока состояние не пришло, показывать пустую
 * диаграмму нельзя — она читается как «в проекте ничего нет». Отказ 404
 * означает и несуществующий проект, и чужой: интерфейс не знает разницы и не
 * притворяется, что знает.
 */
export function Project() {
  const { t } = useLocale();
  const { projectId = "" } = useParams();
  const canWrite = useCanWrite();
  const role = useOrgRole();
  // Тот же признак, что и у ленты: выезд карточки — такое же движение, как
  // переезд полоски, и выключаться они обязаны вместе.
  const reducedMotion = usePrefersReducedMotion();
  const [addingCategory, setAddingCategory] = useState(false);
  const [sharing, setSharing] = useState(false);
  const queryClient = useQueryClient();
  // Категория, из строки которой открыли форму задачи. `null` — форма закрыта.
  const [addingTaskIn, setAddingTaskIn] = useState<string | null>(null);
  // Задача, карточка которой открыта. Держится идентификатором, а не самой
  // задачей: после каждого изменения состояние приходит с сервера заново, и
  // карточка, помнящая объект, показывала бы устаревшие данные.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: projectQueryKey(projectId),
    queryFn: () => getProject(projectId),
    retry: false,
  });

  const comments = useQuery({
    queryKey: commentsQueryKey(projectId),
    queryFn: () => listComments(projectId),
    retry: false,
    // Тот же порядок, что и на публичной странице: пока проект не открылся,
    // спрашивать его ленту не о чем.
    enabled: query.isSuccess,
  });

  const send = useMutation({
    mutationFn: (input: { body: string }) => addComment(projectId, input.body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: commentsQueryKey(projectId) }),
  });

  // Живая связь открывается вместе с экраном и живёт, пока он открыт: ревизии
  // соседей приезжают сами, а обрыв — единственное, что запирает редактирование.
  const live = useProjectLive(projectId);

  if (query.isPending) {
    return (
      <main className="screen">
        <p role="status">{t("common.loading")}</p>
      </main>
    );
  }

  if (query.error) {
    return (
      <main className="screen">
        <p className="error" role="alert">
          {t(errorKey(query.error))}
        </p>
      </main>
    );
  }

  // Задача могла исчезнуть между открытием карточки и следующим ответом
  // сервера: её удалили в соседней вкладке. Карточка тогда просто не рисуется.
  const selectedTask = query.data.tasks.find((task) => task.id === selectedTaskId) ?? null;

  const offline = live.status === "offline";
  // Пока связи нет, показанное устарело неизвестно насколько, и любое изменение
  // легло бы поверх чужих правок вслепую. Право при этом никуда не делось —
  // поэтому признаки разные: `canWrite` отвечает на «кому можно», а этот — на
  // «можно ли сейчас».
  const editable = canWrite && !offline;

  return (
    <ShiftReasonProvider>
      <DependencyNudgeProvider>
        <LiveProvider live={live}>
          <main className="screen screen--wide">
            <ProjectHead
              state={query.data}
              showPlan
              planAction={
                <PlanApproval
                  projectId={projectId}
                  state={query.data}
                  canApprove={editable}
                  // Пересогласование — право владельца: оно сдвигает базу, от
                  // которой считаются все объяснённые сдвиги.
                  canReapprove={role === "owner" && !offline}
                />
              }
              // Гостю кнопки не передаются вовсе: они обещали бы действие,
              // которое сервер отклонит.
              actions={
                <>
                  {/* Публикация — действие уровня проекта, поэтому кнопка стоит
                      в его шапке, а не в настройках. Гостю и читателю она не
                      показывается: сервер такую попытку отклонит. */}
                  {canWrite && (
                    <button
                      type="button"
                      className="button--quiet"
                      disabled={offline}
                      onClick={() => setSharing(true)}
                    >
                      {t("share.open")}
                    </button>
                  )}
                  {/* Отмена — там же, где остальные действия над проектом, и
                      только тому, кто может писать: гостю она обещала бы отказ
                      сервера. */}
                  {editable && <UndoButton projectId={projectId} state={query.data} />}
                  {/* Кебаб «⋯», как в макете: редкие действия не стоят своей
                      кнопки в первом ряду. */}
                  {canWrite && (
                    <Menu
                      label={<span aria-hidden="true">⋯</span>}
                      buttonLabel={t("project.more")}
                      showCaret={false}
                      buttonClass="button--quiet project-head__more"
                    >
                      <Link className="menu__item" to={`/projects/${projectId}/settings`}>
                        {t("settings.project.link")}
                      </Link>
                    </Menu>
                  )}
                </>
              }
            />

            {offline && <OfflineBar syncedAt={query.dataUpdatedAt || null} />}

            {/* Предложение подвинуть связанную задачу — над лентой, а не поверх
                неё: оно ненавязчивое и не должно закрывать то, что человек только
                что подвинул. */}
            {editable && <DependencyNudge projectId={projectId} state={query.data} />}

            {/* Диаграмма занимает всю ширину, пока карточка закрыта: пустая колонка
                справа отнимает у ленты треть экрана ради ничего. */}
            <div className={`project__body${reducedMotion ? " motion-off" : ""}`}>
              <Gantt
                projectId={projectId}
                state={query.data}
                canWrite={editable}
                toolbarAction={
                  canWrite ? (
                    <>
                      {/* Сначала категория, потом задача — в порядке, в каком
                          проект и заполняют: задачу некуда класть, пока нет ни
                          одной категории, и кнопка задачи до первой категории
                          не показывается — форма с пустым списком категорий
                          обещала бы действие, которое не может состояться. */}
                      <button
                        type="button"
                        className="button--quiet"
                        disabled={offline}
                        onClick={() => setAddingCategory(true)}
                      >
                        {t("category.create")}
                      </button>
                      {query.data.categories.length > 0 && (
                        <button
                          type="button"
                          className="project-toolbar__primary"
                          disabled={offline}
                          onClick={() => setAddingTaskIn(query.data.categories[0].id)}
                        >
                          {t("task.create")}
                        </button>
                      )}
                    </>
                  ) : undefined
                }
                onAddTask={editable ? setAddingTaskIn : undefined}
                selectedTaskId={selectedTaskId}
                // Повторный щелчок по той же полоске закрывает карточку: люди
                // делают так не задумываясь, и без этого щелчок выглядит
                // бездействием.
                onSelectTask={(taskId) =>
                  setSelectedTaskId((current) => (current === taskId ? null : taskId))
                }
              />

              {selectedTask && (
                <TaskPanel
                  projectId={projectId}
                  task={selectedTask}
                  state={query.data}
                  canWrite={editable}
                  onClose={() => setSelectedTaskId(null)}
                />
              )}
            </div>

            {/* Лента под диаграммой — та же самая, что видит клиент по публичной
                ссылке: разговор живёт в проекте, а не в почте. */}
            <CommentThread
              comments={comments.data ?? []}
              loading={comments.isPending}
              error={comments.error}
              onSend={(input) => send.mutateAsync({ body: input.body })}
              sending={send.isPending}
              sendError={send.error}
            />

            {sharing && <ShareDialog projectId={projectId} onClose={() => setSharing(false)} />}

            {addingCategory && (
              <CategoryForm
                projectId={projectId}
                suggested={suggestColor(query.data.categories.length)}
                onClose={() => setAddingCategory(false)}
              />
            )}

            {addingTaskIn !== null && (
              <TaskForm
                projectId={projectId}
                categories={query.data.categories}
                initialCategoryId={addingTaskIn}
                onClose={() => setAddingTaskIn(null)}
              />
            )}
          </main>
        </LiveProvider>
      </DependencyNudgeProvider>
    </ShiftReasonProvider>
  );
}
