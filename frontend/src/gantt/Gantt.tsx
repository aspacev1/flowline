import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { TASK_STATUSES } from "../api/projects";
import type { Category, ProjectState, Task } from "../api/projects";
import { Menu } from "../components/Menu";
import { endShiftDays, isBeyondPlan } from "../project/baseline";
import { formatDate, formatMonth, weekdayNarrow } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { BarTipProvider } from "./BarTip";
import { Grid } from "./Grid";
import { Header } from "./Header";
import { Arrows } from "./Arrows";
import { CategoryRow, TaskRow } from "./Row";
import { usePrefersReducedMotion } from "./motion";
import { useReorder } from "./useReorder";
import { DAY_WIDTH, ROW_HEIGHT, projectWindow } from "./scale";
import type { Zoom } from "./scale";
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
  onDeleteCategory,
  selectedTaskId = null,
  onSelectTask,
  toolbarAction,
  assigneeNames,
}: {
  projectId: string;
  state: ProjectState;
  /** Может ли этот человек менять проект. Гость только смотрит. */
  canWrite?: boolean;
  /** Плюс на строке категории. Без него диаграмма остаётся на чтение. */
  onAddTask?: (categoryId: string) => void;
  /** Крестик на строке пустой категории. Без него категории не удаляются. */
  onDeleteCategory?: (categoryId: string) => void;
  /** Задача, карточка которой открыта. */
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  /** Primary project action shown beside the working timeline controls. */
  toolbarAction?: ReactNode;
  /**
   * Имена исполнителей по идентификаторам — для карточки наведения.
   *
   * Пропсом, а не запросом изнутри: спрашивает экран, лента получает готовое.
   * Признака «это публичная страница» у ленты нет и заводить его не за чем, а
   * гейт по `canWrite` ошибся бы дважды — на читателе внутри организации,
   * который состав видит, и в офлайне, где право есть, а связи нет.
   */
  assigneeNames?: ReadonlyMap<string, string>;
}) {
  const { t } = useLocale();
  const scroller = useRef<HTMLDivElement>(null);
  const reorder = useReorder({ projectId, state, canWrite });
  const reducedMotion = usePrefersReducedMotion();
  // Лента открывается в дневном масштабе — самом крупном: на нём у деления
  // хватает места на день недели над числом, и первое, что человек видит, —
  // ближайшие дни, а не сжатый до неразличимости квартал.
  const [zoom, setZoom] = useState<Zoom>("day");

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
  const dayWidth = DAY_WIDTH[zoom];
  const scale = useMemo(() => buildScale({ from, to, dayWidth }), [dayWidth, from, to]);

  const formatDay = (iso: string) => formatDate(t, iso);

  // Прокрутка к сегодняшнему дню при открытии: проект длиной в квартал иначе
  // открывается на своём начале, то есть на том, что уже сделано.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (today < scale.from || today > scale.to) return;
    element.scrollLeft = Math.max(0, scale.xOf(today) - scale.dayWidth * 3);
  }, [scale, today]);

  const categories = byPosition(state.categories);
  const tasksByCategory = new Map<string, Task[]>();
  for (const task of byPosition(state.tasks)) {
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
    // Карточка наведения живёт рядом с лентой, а не внутри неё: она стоит по
    // координатам окна, и полоса прокрутки ленты не должна её обрезать.
    <BarTipProvider names={assigneeNames}>
    <div
      className={`gantt gantt--${zoom}${reorder.active ? " is-reordering" : ""}${
        reducedMotion ? " motion-off" : ""
      }`}
      // Высота строки задаётся отсюда: стрелки считают по ней вертикальные
      // координаты, и второе такое же число в стилях однажды разошлось бы с
      // этим.
      style={{ "--gantt-row": `${ROW_HEIGHT}px` } as CSSProperties}
    >
      {/* Тулбар видит и читатель: масштаб и состав слоёв — способы смотреть,
          а не менять, и прятать их от гостя не за что. */}
      <div className="project-toolbar" aria-label={t("gantt.toolbar.label")}>
          {toolbarAction}
          {toolbarAction !== undefined && (
            <span className="project-toolbar__divider" aria-hidden="true" />
          )}
          <span className="project-toolbar__spacer" />

          {/* Масштаб назван вместе со своим значением: свёрнутое меню, в
              отличие от прежнего ряда сегментов, само по себе не показывает,
              в каком масштабе лента сейчас. */}
          <Menu label={t("gantt.toolbar.scale", { value: t(`gantt.toolbar.${zoom}`) })}>
            {(["day", "week", "month"] as const).map((value) => (
              <label key={value} className="menu__item">
                <input
                  type="radio"
                  name="gantt-scale"
                  checked={zoom === value}
                  onChange={() => setZoom(value)}
                />
                {t(`gantt.toolbar.${value}`)}
              </label>
            ))}
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
        <div className="gantt__scroll" ref={scroller}>
          <div className="gantt__canvas">
            <div className="gantt__head-row">
              <div className="gantt__label gantt__corner">
                <span className="gantt__cell gantt__cell--task">
                  <span className="gantt__corner-label">{t("gantt.col.task")}</span>
                </span>
              </div>
              <Header
                scale={scale}
                calendar={state.calendar}
                today={today}
                todayLabel={t("gantt.today")}
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
                        deleteLabel={t("category.delete", { name: category.name })}
                        // Крестик — только у пустой категории: непустую сервер
                        // откажется удалять (сначала разбирают задачи), и
                        // кнопка обещала бы отказ.
                        onDelete={tasks.length === 0 ? onDeleteCategory : undefined}
                        reorder={reorder}
                        open={open}
                        onToggle={() => toggleCategory(category.id)}
                        toggleLabel={t("gantt.toggle_category", { name: category.name })}
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
    </BarTipProvider>
  );
}

/**
 * Легенда — строка условных обозначений над лентой.
 *
 * Перечисляет не один набор, а два, потому что и полоска говорит двумя
 * способами. Заливка означает статус, и статусов ровно четыре — они
 * взаимоисключающие. Просрочка и критичность заливкой не бывают: это флаги
 * поверх любого статуса, и в легенде они показаны тем же, чем рисуются на
 * ленте, — контуром и левой гранью на нейтральной заливке. Сплошным цветом
 * они обещали бы пятый и шестой статус, которых не существует.
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
        <i className="gantt__swatch" data-overlay="late" aria-hidden="true" />
        {t("gantt.late")}
      </span>
      <span className="gantt__legend-item">
        <i className="gantt__swatch" data-overlay="critical" aria-hidden="true" />
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
