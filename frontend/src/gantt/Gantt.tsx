import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { TASK_STATUSES } from "../api/projects";
import type { Category, ProjectState, Task } from "../api/projects";
import { Menu } from "../components/Menu";
import { endShiftDays, isBeyondPlan } from "../project/baseline";
import { formatDate, formatMonth, weekdayNarrow } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { BarTipProvider } from "./BarTip";
import { HeadCells } from "./Cells";
import { Grid } from "./Grid";
import { Header, RelativeHeader } from "./Header";
import { RELATIVE_EPOCH, relativeDayLabel, relativeWindow } from "./relative";
import { Arrows } from "./Arrows";
import { NewTaskRow, PendingRow } from "./NewTaskRow";
import { CategoryRow, TaskRow } from "./Row";
import type { CellLabels, DayFormat } from "./Row";
import { MOTION_MS, usePrefersReducedMotion } from "./motion";
import { useLinkDrag } from "./useLinkDrag";
import { useQuickTask } from "./useQuickTask";
import { useReorder } from "./useReorder";
import {
  COLUMN_KEYS,
  OPTIONAL_COLUMNS,
  defaultLayout,
  layoutWidth,
  reorderColumns,
  toggleColumn,
} from "./columns";
import type { ColumnKey, ColumnLayout } from "./columns";
import { rememberLayout, storedLayout } from "./columns";
import { DAY_WIDTH, ROW_HEIGHT, projectWindow } from "./scale";
import type { Zoom } from "./scale";
import { rememberZoom, storedZoom } from "./scalePreference";
import { addDays, buildScale, daysBetween } from "./timescale";
import { useToday } from "../time/useToday";

import "./gantt.css";

/** Что из необязательных слоёв показывать. Состояние экрана, не проекта. */
type ViewFlags = {
  baseline: boolean;
  legend: boolean;
  summary: boolean;
  caption: boolean;
  critical: boolean;
};

/**
 * Точка, за которую лента держится при пересборке шкалы.
 *
 * Дата, а не пиксель: пиксельное смещение осмысленно только внутри той шкалы,
 * в которой его измерили. Один и тот же `scrollLeft` в дневном масштабе
 * показывает март, а в месячном — уже август, поэтому запоминается день в
 * центре видимой области. Доля дня хранится рядом, чтобы возврат не подтягивал
 * ленту к границе дня на каждой пересборке шкалы: без неё каждое обновление
 * состояния сдвигало бы ленту на полделения.
 */
type Focus = { date: string; fraction: number };

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
  newTaskIn = null,
  onCloseNewTask,
  onDeleteCategory,
  selectedTaskId = null,
  onSelectTask,
  toolbarAction,
  scheduleAction,
  assigneeNames,
}: {
  projectId: string;
  state: ProjectState;
  /** Может ли этот человек менять проект. Гость только смотрит. */
  canWrite?: boolean;
  /** Плюс на строке категории. Без него диаграмма остаётся на чтение. */
  onAddTask?: (categoryId: string) => void;
  /**
   * Категория, в конце которой открыта строка новой задачи. `null` — закрыта.
   *
   * Состоянием снаружи, а не внутри ленты: ту же строку открывает кнопка
   * тулбара, а тулбар приходит с экрана готовым узлом (см. `toolbarAction`), и
   * дотянуться до состояния ленты ему было бы нечем.
   */
  newTaskIn?: string | null;
  onCloseNewTask?: () => void;
  /** Крестик на строке пустой категории. Без него категории не удаляются. */
  onDeleteCategory?: (categoryId: string) => void;
  /** Задача, карточка которой открыта. */
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  /** Primary project action shown beside the working timeline controls. */
  toolbarAction?: ReactNode;
  /**
   * Кнопка «Назначить дату старта» (или «Изменить»). Приходит с экрана, как
   * и toolbarAction: открыть окно привязки — действие проекта, а не ленты, и
   * прав у ленты для него нет.
   */
  scheduleAction?: ReactNode;
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
  const link = useLinkDrag({ projectId, state, canWrite });
  const quick = useQuickTask({ projectId, state });
  const reducedMotion = usePrefersReducedMotion();
  // Лента по умолчанию открывается в дневном масштабе — самом крупном: на
  // нём у деления хватает места на день недели над числом, и первое, что
  // человек видит, — ближайшие дни, а не сжатый до неразличимости квартал.
  // Но если для этого проекта масштаб уже выбирали, лента открывается им:
  // переключение вкладок и уход на другой экран не должны каждый раз
  // спрашивать заново то, что уже решили (см. scalePreference.ts).
  const [zoom, setZoomState] = useState<Zoom>(() => storedZoom(projectId) ?? "day");

  // Экран проекта не размонтирует ленту при смене адреса — те же компоненты
  // просто получают другой `projectId`. Без этого эффекта лента при переходе
  // между проектами тащила бы за собой масштаб предыдущего вместо того,
  // чтобы вспомнить, каким его в последний раз выбрали здесь.
  useEffect(() => {
    setZoomState(storedZoom(projectId) ?? "day");
  }, [projectId]);

  const setZoom = (next: Zoom) => {
    setZoomState(next);
    rememberZoom(projectId, next);
  };

  // Колонки закреплённой таблицы — набор и ширины. Живут там же, где масштаб,
  // и по той же причине: раскладка — состояние экрана, привязанное к проекту,
  // а не свойство плана, и сосед по проекту чужой её получать не должен.
  const [layout, setLayoutState] = useState<ColumnLayout>(
    () => storedLayout(projectId) ?? defaultLayout(),
  );
  useEffect(() => {
    setLayoutState(storedLayout(projectId) ?? defaultLayout());
  }, [projectId]);

  const setLayout = (next: ColumnLayout) => {
    setLayoutState(next);
    rememberLayout(projectId, next);
  };
  const switchColumn = (column: ColumnKey) =>
    setLayout({ ...layout, shown: toggleColumn(layout.shown, column) });
  const resizeColumn = (column: ColumnKey, width: number) =>
    setLayout({ ...layout, widths: { ...layout.widths, [column]: width } });
  const moveColumn = (moved: ColumnKey, before: ColumnKey) =>
    setLayout({ ...layout, shown: reorderColumns(layout.shown, moved, before) });

  // Необязательные слои. Базовый план и сводка по дедлайну видны сразу:
  // первый — язык отклонений, вторая — единственная цифра, которая
  // по-настоящему интересует заказчика. Легенда и сноска ждут, пока их
  // попросят через «Вид», — как в макете, где их нет вовсе.
  const [view, setView] = useState<ViewFlags>({
    baseline: true,
    legend: false,
    summary: true,
    caption: false,
    // Критический путь ждёт, пока его попросят: он красит полоски третьим
    // способом поверх статуса и просрочки, и включённый всегда превращал бы
    // ленту в карту цепочек там, где спрашивают всего лишь «что когда».
    critical: false,
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

  // Задачу заводят и в свёрнутой категории: «плюс» на её строке никуда не
  // девается, да и кнопка тулбара целится в первую по счёту, свёрнута она или
  // нет. Строка, открытая внутри свёрнутого, не видна вовсе — а поле, которого
  // не видно, читается как бездействие. Тот же набор возвращается неизменным,
  // когда разворачивать нечего: новый объект здесь тянул бы перерисовку ленты
  // на каждом ответе сервера.
  useEffect(() => {
    if (newTaskIn === null) return;
    setClosed((current) => {
      if (!current.has(newTaskIn)) return current;
      const next = new Set(current);
      next.delete(newTaskIn);
      return next;
    });
  }, [newTaskIn]);

  // Относительная ось: план ещё не привязан к датам, шкала считает недели
  // проекта от эпохи. Свойство проекта, а не экрана — приходит с сервера.
  const relativeAxis = state.schedule_mode === "relative";
  // Представление уже календарного проекта: назначенные даты никуда не
  // деваются, но план можно снова показать заказчику как «12 недель».
  // Состояние экрана, как масштаб: сосед по проекту его не получает.
  const [calendarView, setCalendarView] = useState(true);
  const relativeView = relativeAxis || (!calendarView && state.start_date !== null);
  // Якорь относительного представления: эпоха у плана без дат, назначенный
  // старт у календарного, показанного в неделях проекта.
  const anchor = relativeAxis ? RELATIVE_EPOCH : (state.start_date ?? RELATIVE_EPOCH);

  // Сегодня — в поясе проекта, а не по UTC: линия сегодняшнего дня обязана
  // стоять там, где у читателя сегодня, и в поясе восточнее Гринвича по UTC
  // она каждую ночь до утра стояла на вчерашнем числе.
  const today = useToday(state.settings?.timezone);
  // Зависимость — границы окна, а не само состояние: после каждого изменения
  // сервер присылает новый объект состояния, и шкала, привязанная к его
  // тождеству, пересобиралась бы всякий раз — вместе со всеми делениями и
  // месяцами, которые от правки одной задачи не изменились.
  const { from, to } = relativeView ? relativeWindow(state, anchor) : projectWindow(state, today);
  const dayWidth = DAY_WIDTH[zoom];
  const scale = useMemo(() => buildScale({ from, to, dayWidth }), [dayWidth, from, to]);

  // В относительном представлении вместо дат — дни проекта: настоящей даты
  // либо ещё нет, либо её просили не показывать.
  const formatDay = (iso: string) =>
    relativeView ? relativeDayLabel(t, iso, anchor) : formatDate(t, iso);

  // Как строки показывают даты и как принимают их обратно. Ввод зеркален
  // показу: там, где строка показала «День 8», она и принимает восьмой день.
  const format: DayFormat = { label: formatDay, relative: relativeView, anchor };

  // Подписи ячеек — один раз на ленту, а не по словарю в каждой строке: на
  // сотне задач это сотня одинаковых обращений за теми же шестью строками.
  const cellLabels: CellLabels = {
    columns: Object.fromEntries(
      COLUMN_KEYS.map((key) => [key, t(`gantt.col.${key}`)]),
    ) as Record<ColumnKey, string>,
    edit: (column, name) => t("gantt.col.edit", { column, name }),
  };

  // Куда лента смотрит сейчас и для какого проекта её уже показали.
  //
  // Прокрутка к сегодняшнему дню — приветствие при открытии проекта, а не
  // ответ на каждую пересборку шкалы. Шкала пересобирается и от смены
  // масштаба, и от правки задачи, раздвинувшей окно проекта, и привязанная к
  // ней прокрутка отбирала бы у человека март, на который он смотрел, всякий
  // раз, когда он трогает ленту.
  const shownFor = useRef<string | null>(null);
  const focus = useRef<Focus | null>(null);

  /**
   * Запомнить день в центре видимой области — в мерках текущей шкалы.
   *
   * Обёрнуто, чтобы не пересоздаваться на каждой перерисовке: иначе прокрутка
   * ниже, которой эта функция нужна, срабатывала бы от любого чужого
   * изменения — от наведения на полоску до свёртки категории.
   */
  const rememberFocus = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const center = (element.scrollLeft + element.clientWidth / 2) / scale.dayWidth;
    const index = Math.floor(center);
    focus.current = { date: addDays(scale.from, index), fraction: center - index };
  }, [scale]);

  // Слой ниже — единственное место, где лента прокручивается сама.
  //
  // Раскладка уже посчитана, но кадр ещё не показан: `useEffect` здесь дал бы
  // видимый прыжок с прежнего места на новое.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;

    // Первый показ проекта: проект длиной в квартал иначе открывается на своём
    // начале, то есть на том, что уже сделано. Дальше — только возврат к
    // запомненному дню.
    if (shownFor.current !== projectId) {
      shownFor.current = projectId;
      // Сегодняшнего дня в окне может и не быть — у проекта, целиком
      // спланированного на прошлую весну. Тогда лента остаётся на своём начале:
      // прокручивать её некуда.
      if (today >= scale.from && today <= scale.to) {
        element.scrollLeft = Math.max(0, scale.xOf(today) - scale.dayWidth * 3);
      }
      // Смена проекта заодно возвращает его масштаб (эффект выше), и шкала
      // пересоберётся ещё раз. Без этой отметки лента осталась бы на пикселе,
      // отмеренном по прежнему масштабу.
      rememberFocus();
      return;
    }

    const held = focus.current;
    if (!held) return;
    element.scrollLeft = Math.max(
      0,
      scale.xOf(held.date) + held.fraction * scale.dayWidth - element.clientWidth / 2,
    );
  }, [projectId, rememberFocus, scale, today]);

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

  // Заводить задачи может только тот, кто может писать: строка ввода у
  // читателя обещала бы отказ сервера. Признак считается один раз — по нему
  // строка и рисуется, и занимает место в счёте строк ниже.
  const newTaskShown = canWrite && newTaskIn !== null;

  // Номера строк в том же порядке, в каком они ниже и рисуются: строка
  // категории, затем её задачи. Нужны стрелкам — им неоткуда узнать, на какой
  // высоте оказалась задача.
  const rowOf = new Map<string, number>();
  let rowCount = 0;
  for (const category of categories) {
    rowCount += 1;
    // Задачи свёрнутой категории строк не занимают, и стрелка к ним не
    // рисуется — ей просто не с чем совпасть (см. Arrows).
    if (!closed.has(category.id)) {
      for (const task of tasksByCategory.get(category.id) ?? []) {
        rowOf.set(task.id, rowCount);
        rowCount += 1;
      }
      // Строки ожидания — тоже строки: они стоят в середине ленты, и стрелки
      // к задачам всех категорий ниже уехали бы на строку вверх, не будь они
      // здесь сосчитаны.
      rowCount += quick.pendingIn(category.id).length;
    }
    // Строка ввода видна и в свёрнутой категории — потому и сосчитана вне
    // условия: категорию сворачивают и посреди набора, а поле, исчезнувшее
    // из-под курсора, унесло бы с собой написанное.
    if (newTaskShown && newTaskIn === category.id) rowCount += 1;
  }

  return (
    // Карточка наведения живёт рядом с лентой, а не внутри неё: она стоит по
    // координатам окна, и полоса прокрутки ленты не должна её обрезать.
    <BarTipProvider
      names={assigneeNames}
      formatDay={relativeView ? (iso) => relativeDayLabel(t, iso, anchor) : undefined}
    >
    <div
      className={`gantt gantt--${zoom}${reorder.active ? " is-reordering" : ""}${
        link.active ? " is-linking" : ""
      }${view.critical ? " show-critical" : ""}${reducedMotion ? " motion-off" : ""}`}
      // Высота строки, ширина закреплённой колонки и длительность переходов
      // задаются отсюда по одной и той же причине: все три величины знает не
      // только CSS. По высоте строки стрелки считают вертикальные координаты,
      // по ширине колонки встают сетка и слой стрелок, по длительности код
      // ведёт переезд полоски. Вторые такие же числа в стилях однажды
      // разошлись бы с ними.
      style={
        {
          "--gantt-row": `${ROW_HEIGHT}px`,
          "--gantt-label": `${layoutWidth(layout)}px`,
          "--motion": `${MOTION_MS}ms`,
        } as CSSProperties
      }
    >
      {/* Тулбар видит и читатель: масштаб и состав слоёв — способы смотреть,
          а не менять, и прятать их от гостя не за что. */}
      <div className="project-toolbar" aria-label={t("gantt.toolbar.label")}>
          {toolbarAction}
          {toolbarAction !== undefined && (
            <span className="project-toolbar__divider" aria-hidden="true" />
          )}
          <span className="project-toolbar__spacer" />

          {/* Индикатор режима: пока план относительный, об этом сказано
              словами, а не только шкалой без месяцев. */}
          {relativeAxis && (
            <span className="project-toolbar__mode">{t("gantt.relative.badge")}</span>
          )}

          {/* Календарный проект помнит, что был относительным: два взгляда на
              одни и те же полоски. Переключатель представления, а не режима —
              назначенные даты никуда не деваются. */}
          {!relativeAxis && state.start_date !== null && (
            <span
              className="project-toolbar__views"
              role="group"
              aria-label={t("gantt.mode.label")}
            >
              {(
                [
                  ["relative", t("gantt.mode.relative")],
                  ["calendar", t("gantt.mode.calendar")],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className="project-toolbar__view"
                  aria-pressed={calendarView === (mode === "calendar")}
                  onClick={() => setCalendarView(mode === "calendar")}
                >
                  {label}
                </button>
              ))}
            </span>
          )}

          {scheduleAction}

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

          {/* Колонки таблицы слева — отдельным меню, а не вместе со слоями:
              «показать столбец с длительностью» и «показать легенду» отвечают
              на разные вопросы, и один список из девяти галочек заставлял бы
              вычитывать его целиком ради любой из них. Название задачи в
              список не входит: строка без имени — строка, по которой нельзя
              понять, о чём она. */}
          <Menu label={t("gantt.toolbar.columns")}>
            {OPTIONAL_COLUMNS.map((column) => (
              <label key={column} className="menu__item">
                <input
                  type="checkbox"
                  checked={layout.shown.includes(column)}
                  onChange={() => switchColumn(column)}
                />
                {cellLabels.columns[column]}
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
                ["critical", t("gantt.view.critical")],
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

      {/* Подсказка вместо сводки по дедлайну: у относительного плана
          настоящих сроков нет, и строка объясняет, что с этим делать. */}
      {relativeAxis && <p className="gantt__plan-hint">{t("gantt.relative.hint")}</p>}

      {/* Сводка сравнивает конец проекта с дедлайном — двумя настоящими
          датами; у относительной оси её не бывает. */}
      {view.summary && !relativeAxis && <Summary state={state} formatDay={formatDay} />}

      {view.legend && categories.length > 0 && <Legend />}

      {categories.length === 0 ? (
        <p className="empty gantt__empty">{t("gantt.empty")}</p>
      ) : (
        <>
        <div className="gantt__scroll" ref={scroller} onScroll={rememberFocus}>
          <div className="gantt__canvas">
            <div className="gantt__head-row">
              <div className="gantt__label gantt__corner">
                <HeadCells
                  layout={layout}
                  labels={cellLabels.columns}
                  onResize={resizeColumn}
                  onReorder={moveColumn}
                  resizeLabel={(column) => t("gantt.col.resize", { column })}
                  reorderLabel={(column) => t("gantt.col.reorder", { column })}
                />
              </div>
              {relativeView ? (
                <RelativeHeader
                  scale={scale}
                  calendar={state.calendar}
                  monthLabel={(number) => t("gantt.relative.month", { number })}
                  weekLabel={(number) => t("gantt.relative.week", { number })}
                />
              ) : (
                <Header
                  scale={scale}
                  calendar={state.calendar}
                  today={today}
                  todayLabel={t("gantt.today")}
                  monthLabel={(iso) => formatMonth(t, iso)}
                  weekdayLabel={(weekday) => weekdayNarrow(t, weekday)}
                />
              )}
            </div>

            <div className="gantt__body">
              <Grid
                scale={scale}
                calendar={state.calendar}
                deadline={state.deadline}
                // Пустая строка вместо даты: линии «сегодня» в относительном
                // представлении нет — настоящих дат на этой шкале не рисуют.
                today={relativeView ? "" : today}
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

              {link.enabled && (
                // Линия связи под пальцем. Слой стоит всегда, а не только на
                // время жеста: его координаты нужны уже в момент нажатия — с
                // них линия и начинается, — а узел, созданный тем же кадром,
                // к этому моменту ещё не смонтирован. Видимость снимает CSS
                // по признаку на корне ленты.
                <svg
                  className="gantt__link-layer"
                  ref={link.layerRef}
                  width={scale.width}
                  height={rowCount * ROW_HEIGHT}
                  aria-hidden="true"
                >
                  <line ref={link.lineRef} className="gantt__link-line" />
                </svg>
              )}

              <div className="gantt__rows">
                {categories.map((category: Category) => {
                  const tasks = tasksByCategory.get(category.id) ?? [];
                  const open = !closed.has(category.id);
                  return (
                    <div key={category.id} className="gantt__group">
                      <CategoryRow
                        projectId={projectId}
                        category={category}
                        tasks={tasks}
                        scale={scale}
                        layout={layout}
                        format={format}
                        canWrite={canWrite}
                        moveLabel={t("gantt.move_category", { name: category.name })}
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
                          calendar={state.calendar}
                          layout={layout}
                          cellLabels={cellLabels}
                          format={format}
                          canWrite={canWrite}
                          late={isLate(task)}
                          lateLabel={t("gantt.late")}
                          title={
                            task.milestone
                              ? `${t("gantt.milestone.short")}, ${formatDay(task.start_date)}`
                              : `${formatDay(task.start_date)} — ${formatDay(task.end_date)}`
                          }
                          selected={task.id === selectedTaskId}
                          onSelect={onSelectTask}
                          reorder={reorder}
                          link={link}
                          assigneeNames={assigneeNames}
                          handleLabel={t("gantt.reorder", { name: task.name })}
                          beyondPlan={isBeyondPlan(state, task)}
                          beyondPlanLabel={t("gantt.beyond_plan")}
                          baselineLabel={baselineLabel(task)}
                          deviationLabel={deviationLabel(task)}
                          statusLabel={t(`task.status.${task.status}`)}
                          showBaseline={view.baseline}
                        />
                      ))}

                      {/* Отправленное и ещё не подтверждённое — в конце
                          категории, там же, где сервер положит настоящую
                          строку: позиция новой задачи — наибольшая занятая
                          плюс один. */}
                      {open &&
                        quick.pendingIn(category.id).map((row) => (
                          <PendingRow
                            key={row.id}
                            layout={layout}
                            scale={scale}
                            name={row.name}
                            title={t("task.new.creating")}
                          />
                        ))}

                      {newTaskShown && newTaskIn === category.id && (
                        <NewTaskRow
                          layout={layout}
                          scale={scale}
                          label={t("task.new.aria", { category: category.name })}
                          placeholder={t("task.new.placeholder")}
                          onCreate={(name) => quick.create(category.id, name)}
                          onClose={() => onCloseNewTask?.()}
                        />
                      )}
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
        <i className="gantt__swatch gantt__swatch--critical" aria-hidden="true" />
        {t("gantt.legend.critical")}
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
