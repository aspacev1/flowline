import { Link } from "react-router-dom";

import { errorKey } from "../api/errors";
import type { ProjectState, Task } from "../api/projects";
import { useAuth } from "../auth/AuthProvider";
import { StatusChip } from "../components/StatusChip";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { useProjectStates } from "./projectStates";
import { toISO } from "../gantt/timescale";

/**
 * «Мои задачи»: всё, что назначено вошедшему, поверх всех проектов.
 *
 * Сортировка — по сроку окончания, готовое в конец: список отвечает на «что
 * горит у меня», а не пересказывает проекты по порядку. Просроченное помечено
 * тем же красным, что и на ленте, — красный здесь всюду значит срок.
 */
export function MyTasks() {
  const { t } = useLocale();
  const { user } = useAuth();
  const { pending, error, states } = useProjectStates();
  const today = toISO(Date.now());

  const mine: { task: Task; project: ProjectState }[] = states
    .flatMap((project) =>
      project.tasks
        .filter((task) => user !== null && task.assignee_ids.includes(user.id))
        .map((task) => ({ task, project })),
    )
    .sort((a, b) => {
      const doneA = a.task.status === "done" ? 1 : 0;
      const doneB = b.task.status === "done" ? 1 : 0;
      if (doneA !== doneB) return doneA - doneB;
      return a.task.end_date < b.task.end_date ? -1 : a.task.end_date > b.task.end_date ? 1 : 0;
    });

  return (
    <main className="screen">
      <div className="screen__head">
        <h1>{t("my_tasks.title")}</h1>
      </div>

      {pending && <p role="status">{t("common.loading")}</p>}

      {error !== null && (
        <p className="error" role="alert">
          {t(errorKey(error))}
        </p>
      )}

      {!pending && error === null && mine.length === 0 && (
        <div className="empty">
          <p className="empty__title">{t("my_tasks.empty.title")}</p>
          <p className="muted">{t("my_tasks.empty.hint")}</p>
        </div>
      )}

      {mine.length > 0 && (
        <ul className="task-list">
          {mine.map(({ task, project }) => {
            const overdue = task.status !== "done" && task.end_date < today;
            return (
              <li key={task.id} className="task-list__row">
                <span className="task-list__main">
                  {/* Имя задачи и проекта — содержимое пользователя. */}
                  <span className="task-list__name">{task.name}</span>
                  <Link to={`/projects/${project.id}`} className="task-list__project muted">
                    {project.name}
                  </Link>
                </span>
                <span className={`task-list__dates${overdue ? " is-late" : ""}`}>
                  {t("project.period", {
                    from: formatShortDate(t, task.start_date),
                    to: formatShortDate(t, task.end_date),
                  })}
                  {overdue && (
                    <span role="img" aria-label={t("my_tasks.overdue")} title={t("my_tasks.overdue")}>
                      {" "}
                      !
                    </span>
                  )}
                </span>
                <StatusChip status={task.status} label={t(`task.status.${task.status}`)} />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
