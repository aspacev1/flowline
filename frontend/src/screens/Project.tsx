import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { errorKey } from "../api/errors";
import { getProject, projectQueryKey } from "../api/projects";
import { useCanWrite, useOrgRole } from "../auth/permissions";
import { Gantt } from "../gantt/Gantt";
import { usePrefersReducedMotion } from "../gantt/motion";
import { useLocale } from "../i18n/LocaleProvider";
import { PlanApproval } from "../project/PlanApproval";
import { ShiftReasonProvider } from "../project/ShiftReason";
import { TaskPanel } from "../task/TaskPanel";
import { CategoryForm, suggestColor } from "./CategoryForm";
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

  return (
    // Провайдер обнимает и ленту, и карточку: окно с причиной одно на все
    // способы сдвинуть задачу — мышью по полоске и полем в карточке.
    <ShiftReasonProvider>
    <main className="screen screen--wide">
      <div className="screen__head">
        {/* Название проекта — содержимое пользователя: приходит с сервера как
            есть и не переводится ни при каком языке интерфейса. */}
        <h1>{query.data.name}</h1>

        {/* Гостю кнопки не показываются вовсе: они обещали бы действие,
            которое сервер отклонит. */}
        <div className="screen__actions">
          {canWrite && (
            <button type="button" onClick={() => setAddingCategory(true)}>
              {t("category.create")}
            </button>
          )}
          {/* Задачу некуда класть, пока нет ни одной категории: кнопка,
              открывающая форму с пустым списком категорий, обещает действие,
              которое не может состояться. */}
          {canWrite && query.data.categories.length > 0 && (
            <button
              type="button"
              onClick={() => setAddingTaskIn(query.data.categories[0].id)}
            >
              {t("task.create")}
            </button>
          )}
          <PlanApproval
            projectId={projectId}
            state={query.data}
            canApprove={canWrite}
            // Переутверждение — право владельца: оно сдвигает базу, от которой
            // считаются все объяснённые сдвиги.
            canReapprove={role === "owner"}
          />
        </div>
      </div>

      {/* Диаграмма занимает всю ширину, пока карточка закрыта: пустая колонка
          справа отнимает у ленты треть экрана ради ничего. */}
      <div className={`project__body${reducedMotion ? " motion-off" : ""}`}>
        <Gantt
          projectId={projectId}
          state={query.data}
          canWrite={canWrite}
          onAddTask={canWrite ? setAddingTaskIn : undefined}
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
            canWrite={canWrite}
            onClose={() => setSelectedTaskId(null)}
          />
        )}
      </div>

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
    </ShiftReasonProvider>
  );
}
