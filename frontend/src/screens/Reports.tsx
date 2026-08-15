import { Link } from "react-router-dom";

import { errorKey } from "../api/errors";
import type { ProjectState } from "../api/projects";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { daysBetween } from "../gantt/timescale";
import { progressOf, statusCounts } from "../project/progress";
import { useToday } from "../time/useToday";
import { useProjectStates } from "./portfolio";

/**
 * Отчёты: таблица «как идут проекты» для того, кто отвечает за все сразу.
 *
 * Одна строка на проект, колонки — то, о чём спрашивают на планёрке:
 * готовность, сколько в работе и заблокировано, сколько просрочено и
 * успевает ли проект к сроку. Никаких графиков ради графиков: числа здесь
 * читают, сравнивая строки, и таблица делает это лучше любой диаграммы.
 */
export function Reports() {
  const { t } = useLocale();
  const { pending, error, states } = useProjectStates();
  // Одна таблица на все проекты: «просрочено» и «успевает ли к сроку»
  // считаются по суткам того, кто её читает (см. useToday).
  const today = useToday();

  return (
    <main className="screen">
      <div className="screen__head">
        <h1>{t("reports.title")}</h1>
      </div>

      {pending && <p role="status">{t("common.loading")}</p>}

      {error !== null && (
        <p className="error" role="alert">
          {t(errorKey(error))}
        </p>
      )}

      {!pending && error === null && states.length === 0 && (
        <div className="empty">
          <p className="empty__title">{t("projects.empty.title")}</p>
          <p className="muted">{t("projects.empty.hint")}</p>
        </div>
      )}

      {states.length > 0 && (
        <table className="report">
          <thead>
            <tr>
              <th scope="col">{t("reports.col.project")}</th>
              <th scope="col">{t("reports.col.progress")}</th>
              <th scope="col">{t("task.status.in_progress")}</th>
              <th scope="col">{t("task.status.blocked")}</th>
              <th scope="col">{t("reports.col.overdue")}</th>
              <th scope="col">{t("reports.col.deadline")}</th>
            </tr>
          </thead>
          <tbody>
            {states.map((state) => (
              <ReportRow key={state.id} state={state} today={today} />
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function ReportRow({ state, today }: { state: ProjectState; today: string }) {
  const progress = progressOf(state.tasks);
  const counts = statusCounts(state.tasks);
  const overdue = state.tasks.filter(
    (task) => task.status !== "done" && task.end_date < today,
  ).length;

  return (
    <tr>
      <th scope="row">
        {/* Название — содержимое пользователя: не переводится. */}
        <Link to={`/projects/${state.id}`}>{state.name}</Link>
      </th>
      <td>{progress === null ? "—" : `${progress}%`}</td>
      <td>{counts.in_progress}</td>
      <td className={counts.blocked > 0 ? "report__warn" : undefined}>{counts.blocked}</td>
      <td className={overdue > 0 ? "report__late" : undefined}>{overdue}</td>
      <td>
        <Deadline state={state} />
      </td>
    </tr>
  );
}

/**
 * Вердикт по сроку — словами, а не датой: дату пришлось бы сравнивать в уме,
 * а «+4 дня» — уже ответ. Без дедлайна вердикта нет: писать «успеваем» там,
 * где успевать не к чему, — выдумывать смысл.
 */
function Deadline({ state }: { state: ProjectState }) {
  const { t } = useLocale();
  if (state.deadline === null || state.project_end === null) {
    return <span className="muted">—</span>;
  }
  const overrun = daysBetween(state.deadline, state.project_end);
  if (overrun > 0) {
    return (
      <span className="report__late">
        {t("reports.deadline_late", { days: t("common.days", { count: overrun }) })}
      </span>
    );
  }
  return (
    <span className="report__fine">
      {t("reports.deadline_fits", { date: formatShortDate(t, state.deadline) })}
    </span>
  );
}
