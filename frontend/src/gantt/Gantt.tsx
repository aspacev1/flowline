import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { MEMBERS_QUERY_KEY, members as fetchMembers } from "../api/org";
import { TASK_STATUSES } from "../api/projects";
import type { Category, ProjectState, Task, TaskStatus } from "../api/projects";
import { Menu } from "../components/Menu";
import { endShiftDays, isBeyondPlan } from "../project/baseline";
import { progressOf } from "../project/progress";
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

/** Что из необязательных слоёв показывать. Состояние экрана, не проекта. */
type ViewFlags = {
  baseline: boolean;
  legend: boolean;
  summary: boolean;
  caption: boolean;
};

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
}) {
  const { t } = useLocale();
  const scroller = useRef<HTMLDivElement>(null);
  const reorder = useReorder({ projectId, state, canWrite });
  const reducedMotion = usePrefersReducedMotion();
  const [zoom, setZoom] = useState<"day" | "week" | "month">("week");

  // Имена для колонки «Владелец». Отказ — не ошибка ленты: гостю и роли
  // `client` состав не отдаётся, и колонка честно показывает прочерки.
  const membersQuery = useQuery({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: fetchMembers,
    retry: false,
    staleTime: Infinity,
  });
  const memberName = new Map((membersQuery.data ?? []).map((member) => [member.id, member.name]));

  // Фильтр — состояние экрана: сосед по проекту не должен получать чужой
  // фильтр, поэтому он не уходит ни на сервер, ни в адрес.
  const [statusFilter, setStatusFilter] = useState<ReadonlySet<TaskStatus>>(new Set());
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const filterActive = statusFilter.size > 0 || ownerFilter !== "";
  const passesFilter = (task: Task) =>
    (statusFilter.size === 0 || statusFilter.has(task.status)) &&
    (ownerFilter === "" || task.assignee_ids.includes(ownerFilter));
  const toggleStatusFilter = (status: TaskStatus) =>
    setStatusFilter((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });

  // Необязательные слои. Базовый план и сводка по дедлайну видны сразу:
  // первый — язык отклонений, вторая — единственная цифра, которая
  // по-настоящему интересует заказчика. Легенда и сноска ждут, пока их
  // попросят через «Вид», — как в макете, где их нет вовсе.
  const [view, setView] = useState<ViewFlags>({
    baseline: true,
    legend: false,
    summary: true,
    caption: false,
  });
  const toggleView = (flag: keyof ViewFlags) =>
    setView((current) => ({ ...current, [flag]: !current[flag] }));

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

  const categories = byPosition(state.categories);
  // Две раскладки по категориям: полная — для полосы охвата и процента
  // категории (фильтр прячет строки, но не меняет, чем категория является),
  // отфильтрованная — для строк, номеров строк и стрелок.
  const allByCategory = new Map<string, Task[]>();
  const tasksByCategory = new Map<string, Task[]>();
  for (const task of byPosition(state.tasks)) {
    allByCategory.set(task.category_id, [...(allByCategory.get(task.category_id) ?? []), task]);
    if (!passesFilter(task)) continue;
    tasksByCategory.set(task.category_id, [...(tasksByCategory.get(task.category_id) ?? []), task]);
  }

  const isLate = (task: Task) => state.deadline !== null && task.end_date > state.deadline;

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
      {/* Тулбар видит и читатель: масштаб, прокрутка месяца и фильтр — способы
          смотреть, а не менять, и прятать их от гостя не за что. */}
      <div className="project-toolbar" aria-label={t("gantt.toolbar.label")}>
          {toolbarAction}
          {toolbarAction !== undefined && (
            <span className="project-toolbar__divider" aria-hidden="true" />
          )}
          <span className="project-toolbar__spacer" />
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

          {/* Фильтр — с точкой на кнопке, пока он не пуст: спрятанные фильтром
              задачи иначе читаются как пропавшие. */}
          <Menu label={t("gantt.toolbar.filter")} active={filterActive}>
            <p className="menu__title">{t("gantt.filter.status")}</p>
            {TASK_STATUSES.map((status) => (
              <label key={status} className="menu__item">
                <input
                  type="checkbox"
                  checked={statusFilter.has(status)}
                  onChange={() => toggleStatusFilter(status)}
                />
                {t(`task.status.${status}`)}
              </label>
            ))}
            {membersQuery.data && membersQuery.data.length > 0 && (
              <>
                <div className="menu__sep" aria-hidden="true" />
                <p className="menu__title">{t("gantt.filter.owner")}</p>
                <label className="menu__item">
                  <select
                    value={ownerFilter}
                    aria-label={t("gantt.filter.owner")}
                    onChange={(event) => setOwnerFilter(event.target.value)}
                  >
                    <option value="">{t("gantt.filter.all")}</option>
                    {membersQuery.data.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {filterActive && (
              <>
                <div className="menu__sep" aria-hidden="true" />
                <button
                  type="button"
                  className="menu__item"
                  onClick={() => {
                    setStatusFilter(new Set());
                    setOwnerFilter("");
                  }}
                >
                  {t("gantt.filter.clear")}
                </button>
              </>
            )}
          </Menu>

          {/* «Вид» включает слои, которых нет в макете, но которые уже есть в
              продукте: легенду, сводку по дедлайну, сноску и призрак базового
              плана. Так они перестают быть спрятанной стилем разметкой. */}
          <Menu label={t("gantt.toolbar.view")}>
            {(
              [
                ["baseline", t("gantt.view.baseline")],
                ["legend", t("gantt.view.legend")],
                ["summary", t("gantt.view.summary")],
                ["caption", t("gantt.view.caption")],
              ] as const
            ).map(([flag, label]) => (
              <label key={flag} className="menu__item">
                <input type="checkbox" checked={view[flag]} onChange={() => toggleView(flag)} />
                {label}
              </label>
            ))}
          </Menu>
      </div>
      {view.summary && <Summary state={state} formatDay={formatDay} />}

      {view.legend && categories.length > 0 && <Legend />}

      {categories.length === 0 ? (
        <p className="empty gantt__empty">{t("gantt.empty")}</p>
      ) : (
        <>
        <div className="gantt__scroll" ref={scroller} onScroll={updateVisibleDate}>
          <div className="gantt__canvas">
            <div className="gantt__head-row">
              <div className="gantt__label gantt__corner">
                <span className="gantt__cell gantt__cell--task">
                  <span className="gantt__corner-label">{t("gantt.col.task")}</span>
                </span>
                <span className="gantt__cell gantt__cell--owner">
                  <span className="gantt__corner-label">{t("gantt.col.owner")}</span>
                </span>
                <span className="gantt__cell gantt__cell--status">
                  <span className="gantt__corner-label">{t("gantt.col.status")}</span>
                </span>
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
                // Отфильтрованные задачи стрелок не получают: стрелка к
                // спрятанной строке указывала бы в пустоту. rowOf этих задач и
                // так не знает — список здесь сужен для честности, а не для
                // геометрии.
                tasks={state.tasks.filter(passesFilter)}
                dependencies={state.dependencies}
                rowOf={rowOf}
                rows={rowCount}
              />

              <div className="gantt__rows">
                {categories.map((category: Category) => {
                  const tasks = tasksByCategory.get(category.id) ?? [];
                  const progress = progressOf(allByCategory.get(category.id) ?? []);
                  const open = !closed.has(category.id);
                  return (
                    <div key={category.id} className="gantt__group">
                      <CategoryRow
                        category={category}
                        // Полоса охвата и процент — по всем задачам категории:
                        // фильтр прячет строки, но не переписывает итоги.
                        tasks={allByCategory.get(category.id) ?? []}
                        scale={scale}
                        addLabel={t("task.add_to", { category: category.name })}
                        onAddTask={onAddTask}
                        reorder={reorder}
                        open={open}
                        onToggle={() => toggleCategory(category.id)}
                        toggleLabel={t("gantt.toggle_category", { name: category.name })}
                        progressLabel={progress === null ? undefined : `${progress}%`}
                      />
                      {open &&
                        tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          projectId={projectId}
                          task={task}
                          scale={scale}
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
                          owners={task.assignee_ids
                            .map((id) => memberName.get(id))
                            .filter((name): name is string => name !== undefined)}
                          statusLabel={t(`task.status.${task.status}`)}
                          showBaseline={view.baseline}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        {/* Сноска под лентой: расшифровка засечки и стрелки — двух знаков,
            которые не объясняются легендой из плашек. Включается в «Виде». */}
        {view.caption && <p className="gantt__caption">{t("gantt.caption")}</p>}
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
  return (
    <p className="gantt__legend">
      {TASK_STATUSES.map((status) => (
        <span key={status} className="gantt__legend-item">
          <i className="gantt__swatch" data-status={status} aria-hidden="true" />
          {t(`task.status.${status}`)}
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
