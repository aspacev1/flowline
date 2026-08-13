import type { ReactNode } from "react";

import type { ProjectState } from "../api/projects";
import { formatDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { changedSinceApproval } from "./baseline";

/**
 * Шапка проекта: название с состоянием плана, сводка, действия справа.
 *
 * Название крупное — это то, куда попал; сводка под ним отвечает на «сколько
 * это и когда» до того, как человек начнёт считать полоски глазами; действия
 * стоят особняком справа — то, ради чего сюда возвращаются.
 *
 * Состояние плана — версия, пометка о расхождении и кнопка согласования —
 * стоит вплотную к названию, а не строкой ниже среди сводки. Расхождение с
 * согласованным планом читается вместе с именем проекта: это то, в каком он
 * состоянии, а не сколько в нём задач. В сводке оно висело хвостом за
 * перечислением категорий и терялось ровно тогда, когда важнее всего.
 */
export function ProjectHead({
  state,
  actions,
  planAction,
  showPlan = false,
}: {
  state: ProjectState;
  /** Кнопки над названием. Гостю не передаются вовсе — их у него нет. */
  actions?: ReactNode;
  /** Кнопка согласования плана. Своей строки не рисует — становится в строку названия. */
  planAction?: ReactNode;
  /**
   * Показывать ли строку плана. Публичная страница её не показывает: версия
   * плана и расхождение с ним — внутренняя кухня, а не то, что обещано клиенту
   * по ссылке.
   */
  showPlan?: boolean;
}) {
  const { t } = useLocale();
  const period = projectPeriod(state);

  const counts = t("project.counts", {
    categories: t("project.category_count", { count: state.categories.length }),
    tasks: t("gantt.task_count", { count: state.tasks.length }),
  });

  return (
    <header className="project-head">
      <div className="project-head__main">
        {/* Название и сводка — одна пара, как в макете Planora: имя проекта
            слева, ключевые действия справа, служебные данные строкой ниже. */}
        <div className="project-head__titles">
          {/* Название проекта — содержимое пользователя: приходит с сервера как
              есть и не переводится ни при каком языке интерфейса. */}
          <div className="project-head__title-row">
            <h1 className="project-head__title">{state.name}</h1>
            {/* Состояние плана едет за названием: у короткого имени стоит
                рядом, за длинным переносится следом — расстояние от имени до
                плашки всегда одно и то же. */}
            {showPlan && (
              <span className="project-head__plan-inline">
                {/* Черновик и согласованный план — один бейдж двух цветов, а не
                    два разных знака: `data-state` называет состояние, цвет ему
                    даёт тема. */}
                <span
                  className="project-head__plan-label"
                  data-state={state.plan_approved_at ? "approved" : "draft"}
                >
                  {state.plan_approved_at
                    ? t("plan.line", { version: state.plan_version })
                    : t("plan.line_draft")}
                </span>
                {changedSinceApproval(state) && (
                  <span className="project-head__plan-note">{t("plan.changed")}</span>
                )}
                {planAction && <span className="project-head__approval">{planAction}</span>}
              </span>
            )}
          </div>

          <p className="project-head__meta">
            {period
              ? t("project.meta", {
                  period: t("project.period", {
                    from: formatDate(t, period.from),
                    to: formatDate(t, period.to),
                  }),
                  counts,
                })
              : counts}
          </p>
        </div>

        {actions && <div className="project-head__actions">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * Срок проекта: от самого раннего старта до самого позднего окончания.
 *
 * Не окно ленты: то округлено до целых месяцев, чтобы шапка диаграммы не
 * начиналась с обрезанного месяца, и «27 июля — 6 сентября» превратилось бы в
 * нём в «1 июля — 30 сентября». Здесь нужен именно срок работ.
 *
 * Посчитанное сервером окончание проекта учитывается наравне с задачами: оно
 * бывает позже последней из них, и сводка, забывшая про него, обещала бы срок
 * короче настоящего. Проект без задач срока не имеет — и строки о нём тоже.
 */
function projectPeriod(state: ProjectState): { from: string; to: string } | null {
  if (state.tasks.length === 0) return null;
  // Строки ISO сравниваются лексикографически ровно как даты: у них
  // фиксированная ширина полей и старший разряд слева.
  const from = state.tasks.map((task) => task.start_date).reduce((a, b) => (a < b ? a : b));
  const to = [
    ...state.tasks.map((task) => task.end_date),
    ...(state.project_end ? [state.project_end] : []),
  ].reduce((a, b) => (a > b ? a : b));
  return { from, to };
}
