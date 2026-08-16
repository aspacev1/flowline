import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";

import { commentCounts, commentCountsQueryKey } from "../api/comments";
import { errorKey } from "../api/errors";
import { MEMBERS_QUERY_KEY, members } from "../api/org";
import { getProject, projectQueryKey } from "../api/projects";
import { useCanWrite, useOrgRole } from "../auth/permissions";
import { Gantt } from "../gantt/Gantt";
import type { NewTaskAt } from "../gantt/Gantt";
import { usePrefersReducedMotion } from "../gantt/motion";
import { useLocale } from "../i18n/LocaleProvider";
import { LiveProvider } from "../live/LiveProvider";
import { OfflineBar } from "../live/OfflineBar";
import { useProjectLive } from "../live/useProjectLive";
import { DependencyNudge, DependencyNudgeProvider } from "../project/DependencyNudge";
import { deleteCategory } from "../project/optimistic";
import { useProjectMutation } from "../project/useProjectMutation";
import { PlanApproval } from "../project/PlanApproval";
import { ProjectHead } from "../project/ProjectHead";
import { ProjectHistory } from "../project/ProjectHistory";
import { ShiftReasonProvider } from "../project/ShiftReason";
import { StartDateDialog } from "../project/StartDateDialog";
import { UndoHotkey } from "../project/UndoHotkey";
import { TaskPanel } from "../task/TaskPanel";
import type { PanelTab } from "../task/TaskPanel";
import { CategoryForm, suggestColor } from "./CategoryForm";
import { ShareDialog } from "./ShareDialog";

/**
 * Экран одного проекта.
 *
 * Три явных состояния, а не два: пока состояние не пришло, показывать пустую
 * диаграмму нельзя — она читается как «в проекте ничего нет». Отказ 404
 * означает и несуществующий проект, и чужой: интерфейс не знает разницы и не
 * притворяется, что знает.
 */
export function Project({ tab = "gantt" }: { tab?: "gantt" | "history" } = {}) {
  const { t } = useLocale();
  const { projectId = "" } = useParams();
  const canWrite = useCanWrite();
  const role = useOrgRole();
  // Тот же признак, что и у ленты: выезд карточки — такое же движение, как
  // переезд полоски, и выключаться они обязаны вместе.
  const reducedMotion = usePrefersReducedMotion();
  const [addingCategory, setAddingCategory] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Окно привязки плана к дате старта — и переноса уже назначенной даты.
  const [scheduling, setScheduling] = useState(false);
  // Где открыта строка новой задачи. `null` — закрыта.
  //
  // Задачу заводят прямо в ленте, а не в окне: план пишут списком, и окно
  // между строками означало бы открыть, заполнить и закрыть его столько раз,
  // сколько в плане дел. Спрашивается одно имя, остальное правится в карточке
  // (см. NewTaskRow).
  const [addingTaskAt, setAddingTaskAt] = useState<NewTaskAt | null>(null);
  // Задача, карточка которой открыта. Держится идентификатором, а не самой
  // задачей: после каждого изменения состояние приходит с сервера заново, и
  // карточка, помнящая объект, показывала бы устаревшие данные.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // С какого раздела открыть карточку. Со строки ленты в неё ведут два пути:
  // по имени и полоске — к свойствам, по счётчику реплик — сразу в обсуждение.
  // Дальше вкладками управляет сама карточка.
  const [selectedTaskTab, setSelectedTaskTab] = useState<PanelTab>("details");
  const openTask = (taskId: string, tab: PanelTab = "details") => {
    setSelectedTaskTab(tab);
    // Повторный щелчок по той же строке закрывает карточку: люди делают так не
    // задумываясь, и без этого щелчок выглядит бездействием. Переход же с имени
    // на счётчик реплик — не повтор, а другой раздел той же карточки, и
    // закрывать её он не должен.
    setSelectedTaskId((current) =>
      current === taskId && tab === selectedTaskTab ? null : taskId,
    );
  };

  const query = useQuery({
    queryKey: projectQueryKey(projectId),
    queryFn: () => getProject(projectId),
    retry: false,
  });

  // Живая связь открывается вместе с экраном и живёт, пока он открыт: ревизии
  // соседей приезжают сами, а обрыв — единственное, что запирает редактирование.
  const live = useProjectLive(projectId);

  const { apply } = useProjectMutation(projectId);
  // Отказ молчит — тем же образом, что у перестановки строк (useReorder):
  // откат догадки внутри `apply` уже вернул категорию на экран, и этого
  // достаточно — удалить успели в соседней вкладке или положили в категорию
  // задачу, и правду покажет ближайший перезапрос.
  const removeCategory = (categoryId: string) => {
    void apply({ type: "delete_category", category_id: categoryId }, (state) =>
      deleteCategory(state, categoryId),
    ).catch(() => {});
  };

  // Состав организации — только ради имён исполнителей в карточке наведения на
  // полоску. Спрашивает экран, а не лента: у ленты нет признака «это публичная
  // страница», и решать, ходить ли за составом, она не должна. Отказ — не
  // ошибка экрана: роль `client` этот маршрут не получает вовсе, и карточка
  // тогда обходится без строки исполнителей.
  const membersQuery = useQuery({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: members,
    retry: false,
    staleTime: Infinity,
  });
  const assigneeNames = useMemo(
    () => new Map((membersQuery.data ?? []).map((member) => [member.id, member.name])),
    [membersQuery.data],
  );

  // Сколько реплик у каждой задачи — число на строке ленты. Отдельным
  // запросом, а не полем состояния: комментарий состояния не меняет, и
  // счётчик, вшитый в него, показывал бы вчерашнее число до ближайшей правки
  // плана. Ключ лежит внутри ключа ленты реплик, поэтому и своя реплика, и
  // чужая по сокету обновляют его тем же сбросом (см. api/comments.ts).
  const countsQuery = useQuery({
    queryKey: commentCountsQueryKey(projectId),
    queryFn: () => commentCounts(projectId),
    retry: false,
  });
  const commentsByTask = useMemo(
    () => new Map(Object.entries(countsQuery.data ?? {})),
    [countsQuery.data],
  );

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
            {/* Ctrl/⌘+Z — на обеих вкладках сразу, а не внутри ленты или
                истории: отменяется последнее изменение проекта, и от того,
                какая вкладка открыта, оно не зависит. */}
            <UndoHotkey projectId={projectId} state={query.data} enabled={editable} />

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
                  {/* Публикация — действие над проектом, и стоит она в общем
                      ряду действий, а не вплотную к названию: у названия теперь
                      живёт состояние плана, а действия собраны в одном месте.
                      Гостю и читателю не показывается: сервер такую попытку
                      отклонит. */}
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
                  {/* Настройки — здесь, а не в боковом меню, куда они на время
                      уезжали: колонка одна на всё приложение, а настройки —
                      этого проекта, и слово «Настройки» в общем ряду не
                      называло, чего именно. Подпись всё равно с подлежащим:
                      в колонке рядом стоит вход в настройки рабочего
                      пространства, и два одинаковых слова на одном экране
                      вернули бы ровно ту двусмысленность, ради которой всё и
                      разводилось. Право то же, что и у остальных действий:
                      читателю ссылка обещала бы отказ сервера. */}
                  {canWrite && (
                    <Link to={`/projects/${projectId}/settings`} className="button-link">
                      {t("settings.project.link")}
                    </Link>
                  )}
                </>
              }
            />

            {offline && <OfflineBar syncedAt={query.dataUpdatedAt || null} />}

            {/* Вкладки — в адресе, а не в состоянии экрана: на историю
                ссылаются в переписке, и ссылка обязана открывать её сразу. */}
            <nav className="tabs" aria-label={t("history.tabs_label")}>
              <NavLink to={`/projects/${projectId}`} end className={tabClass}>
                {t("history.tab_gantt")}
              </NavLink>
              <NavLink to={`/projects/${projectId}/history`} className={tabClass}>
                {t("history.tab_history")}
              </NavLink>
            </nav>

            {tab === "history" && (
              <ProjectHistory projectId={projectId} state={query.data} canUndo={editable} />
            )}

            {/* Предложение подвинуть связанную задачу — над лентой, а не поверх
                неё: оно ненавязчивое и не должно закрывать то, что человек только
                что подвинул. */}
            {tab === "gantt" && editable && (
              <DependencyNudge projectId={projectId} state={query.data} />
            )}

            {/* Диаграмма занимает всю ширину, пока карточка закрыта: пустая колонка
                справа отнимает у ленты треть экрана ради ничего. */}
            {tab === "gantt" && (
            <div className={`project__body${reducedMotion ? " motion-off" : ""}`}>
              <Gantt
                projectId={projectId}
                state={query.data}
                canWrite={editable}
                assigneeNames={assigneeNames}
                toolbarAction={
                  canWrite ? (
                    <>
                      {/* Сначала категория, потом задача — в порядке, в каком
                          проект и заполняют: задачу некуда класть, пока нет ни
                          одной категории, и кнопка задачи до первой категории
                          не показывается — строке ввода негде было бы
                          открыться. Дальше она открывается в первой категории:
                          положить задачу в любую другую — тот же «плюс» на её
                          строке, а перенести написанную можно ручкой. */}
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
                          onClick={() =>
                            setAddingTaskAt({
                              categoryId: query.data.categories[0].id,
                              before: null,
                            })
                          }
                        >
                          {t("task.create")}
                        </button>
                      )}
                    </>
                  ) : undefined
                }
                scheduleAction={
                  canWrite ? (
                    <button
                      type="button"
                      // Первая привязка — главное действие тулбара, как в
                      // макете; перенос уже назначенной даты — тихая кнопка:
                      // главного действия у настроенного проекта здесь нет.
                      className={
                        query.data.schedule_mode === "relative"
                          ? "project-toolbar__primary"
                          : "button--quiet"
                      }
                      disabled={offline}
                      onClick={() => setScheduling(true)}
                    >
                      {query.data.schedule_mode === "relative"
                        ? t("schedule.open")
                        : t("schedule.change")}
                    </button>
                  ) : undefined
                }
                onAddTask={editable ? setAddingTaskAt : undefined}
                newTaskAt={addingTaskAt}
                onCloseNewTask={() => setAddingTaskAt(null)}
                onDeleteCategory={editable ? removeCategory : undefined}
                selectedTaskId={selectedTaskId}
                onSelectTask={(taskId) => openTask(taskId)}
                onOpenComments={(taskId) => openTask(taskId, "comments")}
                commentCounts={commentsByTask}
              />

              {selectedTask && (
                <TaskPanel
                  projectId={projectId}
                  task={selectedTask}
                  state={query.data}
                  canWrite={editable}
                  initialTab={selectedTaskTab}
                  onClose={() => setSelectedTaskId(null)}
                />
              )}
            </div>
            )}

            {sharing && <ShareDialog projectId={projectId} onClose={() => setSharing(false)} />}

            {scheduling && (
              <StartDateDialog
                projectId={projectId}
                state={query.data}
                onClose={() => setScheduling(false)}
              />
            )}

            {addingCategory && (
              <CategoryForm
                projectId={projectId}
                suggested={suggestColor(query.data.categories.length)}
                onClose={() => setAddingCategory(false)}
              />
            )}
          </main>
        </LiveProvider>
      </DependencyNudgeProvider>
    </ShiftReasonProvider>
  );
}

/**
 * Текущая вкладка помечается классом, а не цветом: подчёркивание снизу
 * показывает границы вкладки целиком, и по нему видно, куда попадёт щелчок.
 */
function tabClass({ isActive }: { isActive: boolean }) {
  return `tabs__link${isActive ? " is-current" : ""}`;
}
