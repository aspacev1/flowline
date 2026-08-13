import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { Category, ProjectState, Task } from "../api/projects";
import type { Member } from "../api/org";
import { endShiftDays, isBeyondPlan } from "../project/baseline";
import { formatDate, formatMonth, formatShortDate, weekdayNarrow } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { Grid } from "./Grid";
import { Header } from "./Header";
import { Arrows } from "./Arrows";
import { CategoryRow, TaskRow } from "./Row";
import { usePrefersReducedMotion } from "./motion";
import { useReorder } from "./useReorder";
import { DAY_WIDTH, ROW_HEIGHT, projectWindow } from "./scale";
import { buildScale, daysBetween, toISO } from "./timescale";

import "./gantt.css";

/**
 * Порядок строк — по позиции, а при равенстве по идентификатору.
 *
 * Второй ключ не перестраховка: позиции совпадают в одном настоящем случае —
 * строка, восстановленная отменой на место, которое с тех пор занял сосед. Без
 * него порядок между двумя перерисовками неустойчив, и строки прыгают местами
 * сами по себе.
 */
function byPosition<T extends { position: number; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function Gantt({
  projectId,
  state,
  canWrite = false,
  onAddTask,
  selectedTaskId = null,
  onSelectTask,
  toolbarAction,
  members = [],
}: {
  projectId: string;
  state: ProjectState;
  /** Может ли этот человек менять проект. Гость только смотрит. */
  canWrite?: boolean;
  /** Плюс на строке категории. Без него диаграмма остаётся на чтение. */
  onAddTask?: (categoryId: string) => void;
  /** Задача, карточка которой открыта. */
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  /** Primary project action shown beside the working timeline controls. */
  toolbarAction?: ReactNode;
  /** Organization members used to render the fixed Owner column. */
  members?: Member[];
}) {
  const { t } = useLocale();
  const scroller = useRef<HTMLDivElement>(null);
  const reorder = useReorder({ projectId, state, canWrite });
  const reducedMotion = usePrefersReducedMotion();
  const [zoom, setZoom] = useState<"day" | "week" | "month">("week");

  // Свёрнутые категории. Состояние экрана, а не проекта: сосед по проекту не
  // должен получать чужие свёртки, поэтому оно не уходит на сервер.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const toggleCategory = (id: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const today = toISO(Date.now());
  // Зависимость — границы окна, а не само состояние: после каждого изменения
  // сервер присылает новый объект состояния, и шкала, привязанная к его
  // тождеству, пересобиралась бы всякий раз. Ниже она сама — зависимость
  // прокрутки к сегодняшнему дню, и лента прыгала бы к сегодня после каждой
  // правки, унося с экрана ту задачу, которую только что двигали.
  const { from, to } = projectWindow(state);
  const dayWidth = zoom === "day" ? 42 : zoom === "month" ? 14 : DAY_WIDTH;
  const scale = useMemo(() => buildScale({ from, to, dayWidth }), [dayWidth, from, to]);
  const [visibleDate, setVisibleDate] = useState(today >= from && today <= to ? today : from);

  const formatDay = (iso: string) => formatDate(t, iso);

  // Прокрутка к сегодняшнему дню при открытии: проект длиной в квартал иначе
  // открывается на своём начале, то есть на том, что уже сделано.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (today < scale.from || today > scale.to) return;
    element.scrollLeft = Math.max(0, scale.xOf(today) - scale.dayWidth * 3);
  }, [scale, today]);

  const updateVisibleDate = () => {
    const element = scroller.current;
    if (!element) return;
    setVisibleDate(scale.dateAt(element.scrollLeft + element.clientWidth / 2));
  };

  const moveTimeline = (direction: -1 | 1) => {
    const element = scroller.current;
    if (!element) return;
    element.scrollBy({
      left: direction * Math.max(scale.dayWidth * 7, element.clientWidth * 0.72),
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };

  const goToToday = () => {
    const element = scroller.current;
    if (!element || today < scale.from || today > scale.to) return;
    element.scrollTo({
      left: Math.max(0, scale.xOf(today) - element.clientWidth / 2),
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };

  const categories = byPosition(state.categories);
  const tasksByCategory = new Map<string, Task[]>();
  for (const task of byPosition(state.tasks)) {
    const bucket = tasksByCategory.get(task.category_id);
    if (bucket) bucket.push(task);
    else tasksByCategory.set(task.category_id, [task]);
  }

  const isLate = (task: Task) => state.deadline !== null && task.end_date > state.deadline;

  // Пилюли связей в левой колонке: у источника — «блокер», у приёмника —
  // «ждёт: имя». Считаются по списку зависимостей, а не хранятся у задачи:
  // второго признака, который обязан совпадать со связями, быть не должно.
  const nameOf = new Map(state.tasks.map((task) => [task.id, task.name]));
  const memberNameOf = new Map(members.map((member) => [member.id, member.name]));
  const blocksOf = new Map<string, string[]>();
  const waitsOf = new Map<string, string[]>();
  for (const link of state.dependencies) {
    const from = nameOf.get(link.from_task_id);
    const to = nameOf.get(link.to_task_id);
    // Связь без задачи не рисуется и стрелкой (см. Arrows) — пилюля из неё
    // тоже не делается.
    if (from === undefined || to === undefined) continue;
    blocksOf.set(link.from_task_id, [...(blocksOf.get(link.from_task_id) ?? []), to]);
    waitsOf.set(link.to_task_id, [...(waitsOf.get(link.to_task_id) ?? []), from]);
  }

  /** Подпись бейджа отклонения. Ноль дней бейджа не получает: он ни о чём.
      Единица — короткая («дн.»), как в макете: подпись стоит вплотную к
      полоске, и полное слово толкало бы соседнюю. */
  const deviationLabel = (task: Task) => {
    const shift = endShiftDays(task);
    if (shift === null || shift === 0) return undefined;
    const days = t("common.days_short", { count: Math.abs(shift) });
    return shift > 0 ? t("gantt.deviation_late", { days }) : t("gantt.deviation_early", { days });
  };

  const baselineLabel = (task: Task) =>
    task.baseline_start && task.baseline_end
      ? t("gantt.baseline", {
          from: formatDay(task.baseline_start),
          to: formatDay(task.baseline_end),
        })
      : undefined;

  // Номера строк в том же порядке, в каком они ниже и рисуются: строка
  // категории, затем её задачи. Нужны стрелкам — им неоткуда узнать, на какой
  // высоте оказалась задача.
  const rowOf = new Map<string, number>();
  let rowCount = 0;
  for (const category of categories) {
    rowCount += 1;
    // Задачи свёрнутой категории строк не занимают, и стрелка к ним не
    // рисуется — ей просто не с чем совпасть (см. Arrows).
    if (closed.has(category.id)) continue;
    for (const task of tasksByCategory.get(category.id) ?? []) {
      rowOf.set(task.id, rowCount);
      rowCount += 1;
    }
  }

  return (
    <div
      className={`gantt gantt--${zoom}${reorder.active ? " is-reordering" : ""}${
        reducedMotion ? " motion-off" : ""
      }`}
      // Высота строки задаётся отсюда: стрелки считают по ней вертикальные
      // координаты, и второе такое же число в стилях однажды разошлось бы с
      // этим.
      style={{ "--gantt-row": `${ROW_HEIGHT}px` } as CSSProperties}
    >
      {toolbarAction !== undefined && (
        <div className="project-toolbar" aria-label={t("gantt.toolbar.label")}>
          {toolbarAction}
          <span className="project-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="button--quiet"
            onClick={goToToday}
            disabled={today < scale.from || today > scale.to}
          >
            {t("gantt.today")}
          </button>
          <button
            type="button"
            className="button--quiet project-toolbar__square"
            aria-label={t("gantt.toolbar.previous")}
            onClick={() => moveTimeline(-1)}
          >
            ‹
          </button>
          <strong className="project-toolbar__month" aria-live="polite">
            {formatMonth(t, visibleDate)}
          </strong>
          <button
            type="button"
            className="button--quiet project-toolbar__square"
            aria-label={t("gantt.toolbar.next")}
            onClick={() => moveTimeline(1)}
          >
            ›
          </button>
          <span className="project-toolbar__spacer" />
          <span className="project-toolbar__segments" aria-label={t("gantt.toolbar.zoom")}>
            {(["day", "week", "month"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={zoom === value}
                onClick={() => setZoom(value)}
              >
                {t(`gantt.toolbar.${value}`)}
              </button>
            ))}
          </span>
        </div>
      )}
      <Summary state={state} formatDay={formatDay} />

      {categories.length > 0 && <Legend />}

      {categories.length === 0 ? (
        <p className="empty gantt__empty">{t("gantt.empty")}</p>
      ) : (
        <>
        <div className="gantt__scroll" ref={scroller} onScroll={updateVisibleDate}>
          <div className="gantt__canvas">
            <div className="gantt__head-row">
              <div className="gantt__label gantt__corner">
                <span className="gantt__task-cell gantt__corner-label">{t("gantt.tasks_col")}</span>
                <span className="gantt__owner-cell gantt__corner-label">{t("gantt.owner_col")}</span>
                <span className="gantt__status-cell gantt__corner-label">{t("gantt.status_col")}</span>
              </div>
              <Header
                scale={scale}
                calendar={state.calendar}
                today={today}
                monthLabel={(iso) => formatMonth(t, iso)}
                weekdayLabel={(weekday) => weekdayNarrow(t, weekday)}
              />
            </div>

            <div className="gantt__body">
              <Grid
                scale={scale}
                calendar={state.calendar}
                deadline={state.deadline}
                today={today}
                deadlineLabel={
                  state.deadline ? t("gantt.deadline", { date: formatDay(state.deadline) }) : ""
                }
                todayLabel={t("gantt.today")}
                todayChip={formatShortDate(t, today)}
              />

              <Arrows
                scale={scale}
                tasks={state.tasks}
                dependencies={state.dependencies}
                rowOf={rowOf}
                rows={rowCount}
              />

              <div className="gantt__rows">
                {categories.map((category: Category) => {
                  const tasks = tasksByCategory.get(category.id) ?? [];
                  const open = !closed.has(category.id);
                  return (
                    <div key={category.id} className="gantt__group">
                      <CategoryRow
                        category={category}
                        tasks={tasks}
                        scale={scale}
                        addLabel={t("task.add_to", { category: category.name })}
                        onAddTask={onAddTask}
                        reorder={reorder}
                        open={open}
                        onToggle={() => toggleCategory(category.id)}
                        toggleLabel={t("gantt.toggle_category", { name: category.name })}
                        countLabel={t("gantt.task_count", { count: tasks.length })}
                        progressLabel={`${Math.round(
                          tasks.length === 0
                            ? 0
                            : tasks.reduce((sum, task) => sum + task.progress_pct, 0) / tasks.length,
                        )}%`}
                      />
                      {open &&
                        tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          projectId={projectId}
                          task={task}
                          scale={scale}
                          today={today}
                          canWrite={canWrite}
                          late={isLate(task)}
                          lateLabel={t("gantt.late")}
                          title={`${formatDay(task.start_date)} — ${formatDay(task.end_date)}`}
                          selected={task.id === selectedTaskId}
                          onSelect={onSelectTask}
                          reorder={reorder}
                          handleLabel={t("gantt.reorder", { name: task.name })}
                          beyondPlan={isBeyondPlan(state, task)}
                          beyondPlanLabel={t("gantt.beyond_plan")}
                          baselineLabel={baselineLabel(task)}
                          deviationLabel={deviationLabel(task)}
                          blockerPill={blocksOf.has(task.id) ? t("gantt.pill.blocker") : undefined}
                          blockerTitle={
                            blocksOf.has(task.id)
                              ? t("gantt.pill.blocks", { names: blocksOf.get(task.id)!.join(", ") })
                              : undefined
                          }
                          waitsPill={
                            waitsOf.has(task.id)
                              ? t("gantt.pill.waits", { name: waitsOf.get(task.id)!.join(", ") })
                              : undefined
                          }
                          assigneeNames={task.assignee_ids.map(
                            (id) => memberNameOf.get(id) ?? id.slice(0, 2).toUpperCase(),
                          )}
                          statusLabel={
                            task.criticality === "critical" && task.progress_pct < 100
                              ? t("task.criticality.critical")
                              : t(
                                  `gantt.legend.${
                                    task.progress_pct >= 100
                                      ? "done"
                                      : task.start_date > today
                                        ? "planned"
                                        : "active"
                                  }`,
                                )
                          }
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        {/* Сноска под лентой, как в макете: расшифровка засечки и стрелки —
            двух знаков, которые не объясняются легендой из плашек. */}
        <p className="gantt__caption">{t("gantt.caption")}</p>
        </>
      )}
    </div>
  );
}

/**
 * Легенда — строка условных обозначений над лентой, как в макете Broadsheet.
 *
 * Расшифровывает статусы — именно их означает цвет полоски: насыщенная —
 * в работе, тёмная — готово, контурная — запланировано. Блокер — заливка
 * критической задачи, засечка «+N дн.» — сорванный собственный срок.
 */
function Legend() {
  const { t } = useLocale();
  const statuses = ["active", "done", "planned"] as const;
  return (
    <p className="gantt__legend">
      {statuses.map((status) => (
        <span key={status} className="gantt__legend-item">
          <i className="gantt__swatch" data-status={status} aria-hidden="true" />
          {t(`gantt.legend.${status}`)}
        </span>
      ))}
      <span className="gantt__legend-item">
        <i className="gantt__swatch" data-criticality="critical" aria-hidden="true" />
        {t("gantt.legend.blocker")}
      </span>
      <span className="gantt__legend-item">
        <i className="gantt__swatch gantt__swatch--line gantt__swatch--deadline" aria-hidden="true" />
        {t("gantt.legend.late")}
      </span>
      <span className="gantt__legend-item">
        <i className="gantt__swatch gantt__swatch--line gantt__swatch--today" aria-hidden="true" />
        {t("gantt.today")}
      </span>
    </p>
  );
}

/**
 * Плашка с итогом по дедлайну.
 *
 * Единственная цифра, которая по-настоящему интересует заказчика, поэтому она
 * висит постоянно, а не появляется по наведению. Без дедлайна плашки нет:
 * писать «успеваем» там, где успевать не к чему, — это выдумывать смысл.
 */
function Summary({
  state,
  formatDay,
}: {
  state: ProjectState;
  formatDay: (iso: string) => string;
}) {
  const { t } = useLocale();
  if (state.deadline === null || state.project_end === null) return null;

  const overrun = daysBetween(state.deadline, state.project_end);
  const params = {
    end: formatDay(state.project_end),
    deadline: formatDay(state.deadline),
    days: t("common.days", { count: Math.abs(overrun) }),
  };

  return (
    <p className={`gantt__summary${overrun > 0 ? " is-late" : " is-fine"}`}>
      {overrun > 0 ? t("gantt.summary.late", params) : t("gantt.summary.fits", params)}
    </p>
  );
}
