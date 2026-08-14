import type { ReactNode } from "react";

import type { ProjectState } from "../api/projects";
import { formatDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { changedSinceApproval, isBeyondPlan } from "./baseline";
import { statusCounts } from "./progress";

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

          {/* Срок работ и ничего больше. Счёт категорий и задач ушёл: полоса
              метрик ниже называет то же число задач крупно и в ряду
              остальных, а счёт категорий не отвечал ни на один вопрос,
              который задают, открыв проект. Проекту без задач срока нет — и
              строки тоже. */}
          {period && (
            <p className="project-head__meta">
              {t("project.period", {
                from: formatDate(t, period.from),
                to: formatDate(t, period.to),
              })}
            </p>
          )}
        </div>

        {actions && <div className="project-head__actions">{actions}</div>}
      </div>

      <ProjectMetrics state={state} showPlan={showPlan} />
    </header>
  );
}

/**
 * Полоса метрик под названием проекта.
 *
 * Отвечает на «сколько тут работы и что с ней не так» цифрами, а не цветом
 * полосок: сводка выше называет объём, полоса — состояние. Четыре статуса не
 * пересекаются и в сумме дают «Всего», а «После дедлайна проекта» и «Вне
 * плана» — флаги поверх статуса и в сумму не входят.
 *
 * Отсюда следствие, которое стоит держать в голове, читая цифры: завершённая
 * задача тоже попадает в просроченные, если кончилась позже дедлайна.
 * «Завершено» и «После дедлайна проекта» пересекаются намеренно — это ответы
 * на разные вопросы: «сделано ли» и «в срок ли».
 */
function ProjectMetrics({ state, showPlan }: { state: ProjectState; showPlan: boolean }) {
  const { t } = useLocale();
  const metrics = projectMetrics(state, showPlan);

  return (
    <ul className="project-head__metrics" aria-label={t("project.metrics.label")}>
      {metrics.map((metric) => (
        <li
          key={metric.key}
          className={`project-head__metric${metric.warn ? " is-warn" : ""}`}
        >
          <strong className="project-head__metric-value">{metric.value}</strong>
          <span className="project-head__metric-label">
            {t(`project.metrics.${metric.key}`)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Одна ячейка полосы. `warn` — красное число: состояние, требующее решения. */
type Metric = { key: string; value: number; warn?: boolean };

/**
 * Семь цифр полосы — или шесть на публичной странице.
 *
 * «Вне плана» считается по базовому плану, и её нет там, где нет и самой
 * строки плана: версия плана и расхождения с ним по ссылке не выводятся
 * (`showPlan`), и одна цифра не должна обходить это правило с чёрного хода.
 *
 * Просрочка меряется дедлайном проекта, а не собственным сроком задачи —
 * тем же счётом, которым лента ставит на полоску засечку. Дедлайн в модели
 * один на проект; отклонение задачи от её базового плана — другая величина,
 * и её показывает бейдж «+N дн.» рядом с полоской. Подпись ячейки называет
 * дедлайн проекта прямо, чтобы эти двое не читались как одно.
 */
function projectMetrics(state: ProjectState, showPlan: boolean): Metric[] {
  const counts = statusCounts(state.tasks);
  const { deadline } = state;
  const overdue =
    deadline === null ? 0 : state.tasks.filter((task) => task.end_date > deadline).length;

  return [
    { key: "total", value: state.tasks.length },
    { key: "in_progress", value: counts.in_progress },
    { key: "blocked", value: counts.blocked, warn: true },
    { key: "overdue", value: overdue, warn: true },
    { key: "not_started", value: counts.planned },
    // Работа сверх плана тревогой не набирается: добавлять её нормально —
    // тревожен скрытый перенос сроков, и о нём говорит бейдж отклонения.
    ...(showPlan
      ? [
          {
            key: "not_planned",
            value: state.tasks.filter((task) => isBeyondPlan(state, task)).length,
          },
        ]
      : []),
    { key: "completed", value: counts.done },
  ];
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
