import { useId } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode, RefCallback } from "react";

import type { Calendar, Category, Task } from "../api/projects";
import { useLocale } from "../i18n/LocaleProvider";
import { baselineOf, endShiftDays } from "../project/baseline";
import { patchProgress, patchTask } from "../project/optimistic";
import { useProjectMutation } from "../project/useProjectMutation";
import { AssignMenu } from "./AssignMenu";
import { useBarTip } from "./BarTip";
import { Cell, EditableCell, rollUp } from "./Cells";
import type { ColumnKey, ColumnLayout } from "./columns";
import { dateOfProjectDay, projectDayNumber } from "./relative";
import { workingDaysBetween } from "./scale";
import { useBarMotion } from "./useBarMotion";
import { useDragCategory } from "./useDragCategory";
import { useDragDates } from "./useDragDates";
import type { LinkDrag } from "./useLinkDrag";
import { halfOf } from "./useReorder";
import type { Reorder } from "./useReorder";
import type { Scale } from "./timescale";

/**
 * Как строка показывает даты и как их принимает обратно.
 *
 * Приходит из ленты, а не собирается здесь: у относительного плана настоящих
 * дат нет, и «14 августа» на его шкале — это выдумка. Ввод зеркален показу —
 * там, где строка показала «День 8», она и принимает восьмой день, а не дату.
 */
export type DayFormat = {
  /** Дата в том виде, в каком её читают глазами. */
  label: (iso: string) => string;
  /** Ось относительная: правка старта идёт номером дня проекта, а не датой. */
  relative: boolean;
  /** Начало относительной оси: эпоха либо назначенный старт. */
  anchor: string;
};

/**
 * Подписи ячеек. Собраны лентой один раз и переданы вниз, а не взяты словарём
 * в каждой строке: на сотне задач это сотня одинаковых обращений к словарю за
 * теми же шестью строками.
 */
export type CellLabels = {
  columns: Record<ColumnKey, string>;
  /** «Изменить {что} у {задачи}» — подпись поля, открытого на месте. */
  edit: (column: string, name: string) => string;
};

/**
 * Ячейки закреплённой колонки для одной строки.
 *
 * Первая колонка отдана содержимым — в ней живут шеврон, ручка, имя и флажки;
 * остальные раскладываются одинаково и потому собираются здесь по списку.
 */
function LabelCells({
  layout,
  task,
  cells,
}: {
  layout: ColumnLayout;
  /** Содержимое колонки названия: у категории и задачи оно разное. */
  task: ReactNode;
  /** Готовое содержимое остальных колонок. Пустая — прочерк. */
  cells: Partial<Record<ColumnKey, ReactNode>>;
}) {
  return (
    <>
      {layout.shown.map((column) => (
        <Cell key={column} column={column} layout={layout}>
          {column === "task" ? task : (cells[column] ?? <span className="muted">—</span>)}
        </Cell>
      ))}
    </>
  );
}

/**
 * Строка-заголовок категории: шеврон и название.
 *
 * Полоса рисуется по крайним датам содержимого, а не по отдельно хранимым
 * границам категории: вторых не существует, и заводить их значило бы держать
 * значение, которое обязано совпадать с задачами, но однажды разойдётся.
 *
 * За эту же полосу категорию и двигают: этап целиком уезжает на неделю —
 * обычное дело, и до этого оно означало перетащить каждую полоску по очереди
 * (см. useDragCategory).
 */
export function CategoryRow({
  projectId,
  category,
  tasks,
  scale,
  layout,
  format,
  addLabel,
  onAddTask,
  deleteLabel,
  onDelete,
  reorder,
  canWrite = false,
  moveLabel,
  open = true,
  onToggle,
  toggleLabel,
}: {
  projectId: string;
  category: Category;
  tasks: Task[];
  scale: Scale;
  layout: ColumnLayout;
  /** Строка категории — сводка, а не правка: её ячейки только показывают. */
  format: DayFormat;
  addLabel: string;
  onAddTask?: (categoryId: string) => void;
  deleteLabel?: string;
  /** Крестик удаления. Передаётся только для пустой категории: непустую
      сервер откажется удалять, и кнопка обещала бы отказ. */
  onDelete?: (categoryId: string) => void;
  reorder?: Reorder;
  /** Может ли этот человек двигать категорию целиком. */
  canWrite?: boolean;
  moveLabel?: string;
  /** Развёрнута ли категория: свёрнутая прячет свои строки задач. */
  open?: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
}) {
  const span = rollUp(tasks);
  const drag = useDragCategory({
    projectId,
    category,
    scale,
    // Пустую категорию двигать нечем: сервер откажет, полосы на ленте и так нет.
    enabled: canWrite && tasks.length > 0,
  });

  return (
    <div
      className={`gantt__row gantt__row--category ${reorder?.markFor("category", category.id) ?? ""}`.trimEnd()}
      // Заголовок категории — тоже цель броска: перенести задачу в другую
      // категорию иначе можно было бы только через список в карточке.
      //
      // Чем строка приходится броску, сказано прямо в разметке: пальцем
      // события до неё не доходят вовсе, и ручка ищет её попаданием в точку —
      // по найденному элементу узнать строку больше не по чему (см. `targetAt`
      // в useReorder).
      data-drop-kind="category"
      data-drop-id={category.id}
      onPointerMove={() => reorder?.over({ kind: "category", id: category.id, half: "bottom" })}
      onPointerUp={() => reorder?.drop()}
    >
      <div className="gantt__label">
        <LabelCells
          layout={layout}
          cells={{
            start: span && <span className="gantt__cell-value">{format.label(span.start)}</span>,
            end: span && <span className="gantt__cell-value">{format.label(span.end)}</span>,
            progress: span && <span className="gantt__cell-value">{span.progress}%</span>,
          }}
          task={
            <>
              {onToggle && (
                // Шеврон — кнопка сворачивания, как в макете: свёрнутая категория
                // остаётся строкой с полосой охвата, её задачи прячутся.
                <button
                  type="button"
                  className="gantt__chevron"
                  aria-expanded={open}
                  aria-label={toggleLabel}
                  title={toggleLabel}
                  onClick={onToggle}
                >
                  {open ? "▾" : "▸"}
                </button>
              )}
              <span className="gantt__label-name">{category.name}</span>
              {onAddTask && (
                // Подпись включает название категории: на десятке категорий десять
                // кнопок «Добавить задачу» при чтении с экрана неразличимы, и
                // выбрать нужную нельзя иначе как считая их по порядку.
                <button
                  type="button"
                  className="gantt__add"
                  aria-label={addLabel}
                  title={addLabel}
                  onClick={() => onAddTask(category.id)}
                >
                  +
                </button>
              )}
              {onDelete && (
                // Подпись с названием — по той же причине, что у «плюса»:
                // безымянные крестики при чтении с экрана неразличимы.
                // Подтверждения нет намеренно: удаляется только пустая
                // категория, и отмена возвращает её одной кнопкой.
                <button
                  type="button"
                  className="gantt__remove"
                  aria-label={deleteLabel}
                  title={deleteLabel}
                  onClick={() => onDelete(category.id)}
                >
                  ×
                </button>
              )}
            </>
          }
        />
      </div>

      <div className="gantt__lane" style={{ width: scale.width }}>
        {span && (
          <div
            ref={drag.spanRef}
            className={`gantt__span${drag.handlers ? " is-draggable" : ""}${
              drag.dragging ? " is-dragging" : ""
            }`}
            style={{
              left: scale.xOf(span.start),
              width: scale.widthOf(span.start, span.end),
              background: category.color,
              // Тем же цветом красятся засечки-стрелки по краям полосы: они
              // рисуются рамкой на псевдоэлементах и берут его через
              // `currentColor` — второго места с цветом категории не заводим.
              color: category.color,
            }}
            title={drag.handlers ? moveLabel : undefined}
            // Полоса не орган управления даже когда её тащат: перенос этапа
            // мышью — ускорение, а не единственный путь, и с клавиатуры те же
            // задачи двигаются каждая своей полоской. Кнопка здесь обещала бы
            // действие по Enter, которого нет.
            aria-hidden="true"
            {...drag.handlers}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Строка задачи.
 *
 * Полоска — кнопка, а не `div` с обработчиком, везде, где по ней кликают или
 * ходят с клавиатуры: кнопка приносит фокус, роль и реакцию на Enter даром,
 * `div` пришлось бы доводить до того же руками и забыть половину. Там, где она
 * не делает ни того ни другого — на публичной странице, — она объявляется
 * картинкой; см. `Bar` ниже.
 */
export function TaskRow({
  projectId,
  task,
  scale,
  calendar,
  layout,
  cellLabels,
  format,
  late,
  lateLabel,
  title,
  canWrite = false,
  selected = false,
  onSelect,
  reorder,
  link,
  handleLabel,
  beyondPlan = false,
  beyondPlanLabel,
  baselineLabel,
  deviationLabel,
  statusLabel,
  showBaseline = true,
  assigneeNames,
  commentCount = 0,
  onOpenComments,
  onInsertBefore,
}: {
  projectId: string;
  task: Task;
  scale: Scale;
  /** Рабочий календарь: им правая грань переводит день в длительность. */
  calendar: Calendar;
  layout: ColumnLayout;
  cellLabels: CellLabels;
  format: DayFormat;
  late: boolean;
  lateLabel: string;
  title: string;
  canWrite?: boolean;
  /** Открыта ли карточка этой задачи. */
  selected?: boolean;
  onSelect?: (taskId: string) => void;
  reorder?: Reorder;
  /** Протягивание связи от кружка на краю полоски. У гостя его нет. */
  link?: LinkDrag;
  handleLabel?: string;
  /** Задача добавлена после утверждения плана. */
  beyondPlan?: boolean;
  beyondPlanLabel?: string;
  /** Подпись призрака: даты утверждённого плана. */
  baselineLabel?: string;
  /** Готовая подпись бейджа отклонения, например «+7 дней». */
  deviationLabel?: string;
  /** Подпись плашки статуса — нужна только полоске «заблокировано». */
  statusLabel?: string;
  /** Рисовать ли призрак и засечку базового плана — флажок меню «Вид». */
  showBaseline?: boolean;
  /**
   * Состав организации: имена по идентификаторам. Им подписаны исполнители
   * задачи — и из него же выбирают новых (см. AssignMenu). `undefined` —
   * состава не знаем вовсе (публичная страница, роль без права на список), и
   * тогда колонка исполнителей молчит, а назначать некого.
   */
  assigneeNames?: ReadonlyMap<string, string>;
  /** Сколько реплик у задачи. Ноль числа не показывает — показывать нечего. */
  commentCount?: number;
  /** Открыть обсуждение задачи. `undefined` — карточки нет (гость). */
  onOpenComments?: (taskId: string) => void;
  /** Завести задачу прямо над этой строкой. `undefined` — читателю. */
  onInsertBefore?: () => void;
}) {
  const { t } = useLocale();
  const { apply } = useProjectMutation(projectId);
  // Узел с названием задачи: им подписана кнопка исполнителей — она называет
  // себя «Исполнители», а какой задачи, говорит описанием (см. AssignMenu).
  const nameId = useId();
  // Место полоски по датам. Считается здесь, а не в разметке ниже, потому что
  // его знать нужно двоим: самой разметке и слою движения — тот сравнивает его
  // с местом на прошлом рендере и по разнице показывает переезд.
  const left = scale.xOf(task.start_date);
  // Веха занимает один день независимо от того, что лежит в длительности:
  // ромб стоит в своём дне, а не растягивается по нему.
  const width = task.milestone
    ? scale.dayWidth
    : scale.widthOf(task.start_date, task.end_date);
  const motion = useBarMotion({ left, scaleKey: scale.key });
  const { dragging, handlers, gripHandlers } = useDragDates({
    projectId,
    task,
    scale,
    calendar,
    enabled: canWrite,
    motion,
  });
  const tip = useBarTip(task, canWrite);
  const baseline = baselineOf(task);
  const shift = endShiftDays(task);

  // Правки прямо в таблице. Каждая — та же операция, что и в карточке задачи:
  // ячейка не заводит своего способа менять срок, она вызывает уже
  // существующий. Отказ откатывает `apply`, и ячейка возвращается к правде
  // сама — своего состояния «не сохранилось» у неё нет.
  const edit = {
    start: (value: string) => {
      const start = format.relative ? dateOfProjectDay(Number(value), format.anchor) : value;
      if (start === task.start_date) return;
      void apply({ type: "move_task", task_id: task.id, start_date: start }, (state) =>
        patchTask(state, task.id, { start_date: start }),
      ).catch(() => {});
    },
    end: (value: string) => {
      const finish = format.relative ? dateOfProjectDay(Number(value), format.anchor) : value;
      if (finish < task.start_date) return;
      const duration_days = Math.max(1, workingDaysBetween(task.start_date, finish, calendar));
      if (duration_days === task.duration_days) return;
      void apply({ type: "set_duration", task_id: task.id, duration_days }, (state) =>
        patchTask(state, task.id, { duration_days }),
      ).catch(() => {});
    },
    duration: (value: string) => {
      const duration_days = Number(value);
      if (!Number.isInteger(duration_days) || duration_days < 1) return;
      void apply({ type: "set_duration", task_id: task.id, duration_days }, (state) =>
        patchTask(state, task.id, { duration_days }),
      ).catch(() => {});
    },
    progress: (value: string) => {
      const pct = Math.min(100, Math.max(0, Math.round(Number(value))));
      if (!Number.isFinite(pct) || pct === task.progress_pct) return;
      void apply({ type: "set_progress", task_id: task.id, progress_pct: pct }, (state) =>
        patchProgress(state, task.id, pct),
      ).catch(() => {});
    },
  };

  const assignees = task.assignee_ids
    .map((id) => assigneeNames?.get(id))
    .filter((name): name is string => name !== undefined);

  // Исполнителей раздают со строки, а не только из карточки. Кнопка стоит в
  // своей колонке, когда та показана, и в колонке имени, когда нет: орган
  // управления один, и рисовать его дважды значило бы завести два места, где
  // одно и то же однажды разойдётся.
  const assign =
    canWrite && assigneeNames !== undefined && assigneeNames.size > 0 ? (
      <AssignMenu
        projectId={projectId}
        task={task}
        roster={assigneeNames}
        describedBy={nameId}
      />
    ) : null;
  const assignInColumn = assign !== null && layout.shown.includes("assignee");
  const assignInName = assignInColumn ? null : assign;

  // Счётчик обсуждения. Ноль числа не рисует: «0» на каждой из ста строк — это
  // рябь, в которой не видно единственной строки, где разговор есть. Сам знак
  // при этом остаётся — его показывает наведение (см. gantt.css), иначе
  // открыть разговор со строки было бы нечем.
  //
  // Не кнопка — по той же причине, что и имя задачи рядом (см. ниже): то же
  // обсуждение открывается с клавиатуры полоской и вкладкой в карточке, а
  // вторая кнопка на каждой из ста строк была бы сотней лишних шагов Tab, ни
  // один из которых не ведёт туда, куда нельзя дойти иначе. Числу при этом
  // нужно имя: без него с экрана читается голая цифра.
  const commentsLabel = t("gantt.comments.aria", { name: task.name, count: commentCount });
  const comments =
    commentCount === 0 && onOpenComments === undefined ? null : (
      <span
        className={`gantt__row-action${commentCount > 0 ? " is-set" : ""}${
          onOpenComments ? " is-clickable" : ""
        }`}
        role="img"
        aria-label={commentsLabel}
        title={commentsLabel}
        onClick={onOpenComments ? () => onOpenComments(task.id) : undefined}
      >
        <CommentIcon />
        {commentCount > 0 && commentCount}
      </span>
    );

  return (
    <div
      className={`gantt__row${selected ? " is-selected" : ""} ${
        reorder?.markFor("task", task.id) ?? ""
      }`.trimEnd()}
      data-drop-kind="task"
      data-drop-id={task.id}
      onPointerMove={(event) =>
        reorder?.over({
          kind: "task",
          id: task.id,
          half: halfOf(event.currentTarget, event.clientY),
        })
      }
      onPointerUp={() => reorder?.drop()}
    >
      <div className="gantt__label">
        <LabelCells
          layout={layout}
          cells={{
            start: (
              <EditableCell
                type={format.relative ? "number" : "date"}
                value={
                  format.relative
                    ? String(projectDayNumber(task.start_date, format.anchor))
                    : task.start_date
                }
                display={format.label(task.start_date)}
                disabled={!canWrite}
                min={format.relative ? 1 : undefined}
                label={cellLabels.edit(cellLabels.columns.start, task.name)}
                onCommit={edit.start}
              />
            ),
            // Дата окончания правится не собой, а длительностью: сервер
            // считает её по рабочему календарю, и записать её напрямую нельзя
            // — но «эта задача кончается такого-то числа» человек говорит
            // именно так. Ячейка переводит названный день в число рабочих
            // дней ровно тем же счётом, каким это делает правая грань полоски,
            // и шлёт ту же операцию. Сервер пересчитает конец сам и пришлёт
            // свой — если календарь у вкладки устарел, ячейка встанет по его
            // ответу, а не по догадке.
            end: (
              <EditableCell
                type={format.relative ? "number" : "date"}
                value={
                  format.relative
                    ? String(projectDayNumber(task.end_date, format.anchor))
                    : task.end_date
                }
                display={format.label(task.end_date)}
                disabled={!canWrite || task.milestone}
                min={format.relative ? 1 : undefined}
                label={cellLabels.edit(cellLabels.columns.end, task.name)}
                onCommit={edit.end}
              />
            ),
            duration: (
              <EditableCell
                type="number"
                value={String(task.duration_days)}
                display={
                  // У вехи длительности нет — есть день, в который она
                  // случается. Показать «1 дн.» значило бы назвать отрезком то,
                  // что нарисовано точкой.
                  task.milestone
                    ? t("gantt.milestone.short")
                    : t("common.days_short", { count: task.duration_days })
                }
                disabled={!canWrite || task.milestone}
                min={1}
                label={cellLabels.edit(cellLabels.columns.duration, task.name)}
                onCommit={edit.duration}
              />
            ),
            progress: (
              <EditableCell
                type="number"
                value={String(task.progress_pct)}
                display={`${task.progress_pct}%`}
                disabled={!canWrite}
                min={0}
                max={100}
                label={cellLabels.edit(cellLabels.columns.progress, task.name)}
                onCommit={edit.progress}
              />
            ),
            // Тернарник, а не `&&`: пустой список обязан дойти до ячейки как
            // «нечего показать» (прочерк), а `false` от неё неотличим от
            // намеренно пустого содержимого и стёр бы прочерк.
            // Кнопка выбора занимает эту ячейку целиком, когда назначать
            // можно: она же и показывает назначенных — аватарами.
            assignee: assignInColumn
              ? assign
              : assignees.length > 0
                ? (
                    <span className="gantt__cell-value" title={assignees.join(", ")}>
                      {assignees.join(", ")}
                    </span>
                  )
                : undefined,
          }}
          task={
            <>
              {onInsertBefore && (
                // «Плюс» на границе строк — как в TeamGantt: задача заводится
                // там, куда указали, а не в конце категории. Стоит он поперёк
                // верхнего края строки, наполовину заезжая на соседа сверху:
                // вставка происходит между ними, и знак обязан стоять там же,
                // где произойдёт то, что он обещает.
                //
                // Не кнопка и скрыт от чтения с экрана — как ручка
                // перестановки рядом, и по той же причине: это выбор места
                // строки в списке, а выбор места с клавиатуры в этот план не
                // входит. Объявить сотню кнопок, ни одна из которых не
                // срабатывает по Enter, хуже, чем не объявлять их вовсе;
                // завести же задачу с клавиатуры по-прежнему можно — «плюсом»
                // на строке категории, который кнопка и есть.
                <span
                  className="gantt__insert"
                  aria-hidden="true"
                  title={t("gantt.insert_before", { name: task.name })}
                  onClick={onInsertBefore}
                >
                  +
                </span>
              )}
              {reorder?.enabled && (
                // Ручка отдельно от полоски: за неё меняют порядок, за полоску —
                // даты.
                //
                // Не кнопка и скрыта от чтения с экрана намеренно. Кнопка обещала бы
                // работу с клавиатуры, а перестановка строк с клавиатуры в этот план
                // не входит: объявить десять кнопок, ни одна из которых не
                // срабатывает по Enter, хуже, чем не объявлять их вовсе. Полоска
                // задачи при этом остаётся кнопкой и по-прежнему двигается стрелками.
                <span
                  className="gantt__handle"
                  aria-hidden="true"
                  title={handleLabel}
                  // Весь жест — на ручке, а не только его начало: пальцем
                  // указатель захвачен ею до самого броска, и строки под
                  // пальцем событий не получают (см. useReorder).
                  {...reorder.handleProps(task.id)}
                >
                  ⠿
                </span>
              )}
              {/* Имя — тоже открывает карточку, не только полоска: его читают
                  раньше полоски и по нему кликают первым, особенно когда
                  полоска обрезана краем ленты. Кнопкой имя не становится —
                  полоска уже даёт то же действие с клавиатуры и для чтения с
                  экрана, а вторая кнопка с тем же именем на строке была бы для
                  них лишним, неотличимым от первой шагом Tab. Клик остаётся
                  доступен указателем и не обещает того, чего не выполняет. */}
              <span
                id={nameId}
                className={`gantt__label-name${onSelect ? " gantt__label-name--clickable" : ""}`}
                onClick={onSelect ? () => onSelect(task.id) : undefined}
              >
                {task.name}
              </span>
              {late && (
                <span className="gantt__flag" title={lateLabel} role="img" aria-label={lateLabel}>
                  !
                </span>
              )}
              {beyondPlan && (
                // «Сверх первоначального плана»: задача добавлена после утверждения
                // и базового плана не имеет. Пометка нужна не как украшение — без
                // неё отсутствие призрака под полоской читается как «задача никуда
                // не уехала», а на деле сравнивать её просто не с чем.
                <span
                  className="gantt__beyond"
                  title={beyondPlanLabel}
                  role="img"
                  aria-label={beyondPlanLabel}
                >
                  +
                </span>
              )}

              {/* Хвост колонки имени: обсуждение и исполнители — то, что в
                  TeamGantt показывает наведение на строку. Прижаты вправо,
                  чтобы имена задач читались одним столбцом, а не начинались
                  каждое на своём отступе.

                  Молчат, пока не навели, — но только когда молчать есть о чём:
                  число реплик видно всегда (иначе о разговоре можно узнать,
                  только водя мышью по ста строкам), а кнопка, чтобы этот
                  разговор завести, ждёт наведения (см. gantt.css). */}
              {(comments !== null || assignInName !== null) && (
                <span className="gantt__row-actions">
                  {comments}
                  {assignInName}
                </span>
              )}
            </>
          }
        />
      </div>

      <div className="gantt__lane" style={{ width: scale.width }}>
        {showBaseline && baseline && (
          // Призрак базового плана — тонкая серая полоска под текущей.
          //
          // Именно под, а не продлением текущей: залить разрыв между плановым
          // и фактическим окончанием прямо в полоске выглядит нагляднее, но
          // тогда её начало означает плановую дату, а конец — фактическую, и
          // полоска перестаёт означать реальные даты задачи.
          <div
            className="gantt__ghost"
            style={{
              left: scale.xOf(baseline.start),
              width: scale.widthOf(baseline.start, baseline.end),
            }}
            title={baselineLabel}
            data-testid={`ghost-${task.id}`}
            aria-hidden="true"
          />
        )}

        {showBaseline && baseline && shift !== null && shift > 0 && (
          // Засечка первоначального дедлайна, как в макете: вертикальная
          // красная черта там, где задача должна была кончиться по плану.
          <i
            className="gantt__mark"
            style={{ left: scale.xOf(baseline.end) + scale.dayWidth }}
            title={baselineLabel}
            data-testid={`mark-${task.id}`}
            aria-hidden="true"
          />
        )}

        {shift !== null && shift !== 0 && deviationLabel && (
          // Бейдж отклонения справа от полоски. Отсчитывается от окончания:
          // оно одно отвечает на вопрос «когда это будет готово» и вбирает в
          // себя и перенос начала, и растяжение срока.
          <span
            className={`gantt__deviation${shift > 0 ? " is-late" : " is-early"}`}
            style={{ left: scale.xOf(task.end_date) + scale.dayWidth }}
            data-testid={`deviation-${task.id}`}
          >
            {deviationLabel}
          </span>
        )}

        {/* Кнопка — только когда полоска действительно что-то делает: открывает
            карточку или двигается. На публичной странице она не делает ни
            того, ни другого, и кнопка там обещала бы действие, которого нет, —
            забирала бы фокус с клавиатуры и читалась бы с экрана как
            нажимаемая. Тогда это картинка с подписью, а не орган управления. */}
        <Bar
          interactive={Boolean(onSelect) || canWrite}
          barRef={motion.ref}
          className={`gantt__bar${task.milestone ? " gantt__bar--milestone" : ""}${
            late ? " is-late" : ""
          }${canWrite ? " is-draggable" : ""}${dragging !== null ? " is-dragging" : ""}`}
          data-criticality={task.criticality}
          data-status={task.status}
          // Признак, а не класс: критичность — свойство расчёта, и рисуется
          // она только когда слой включён (см. `.gantt.show-critical`).
          data-critical={task.critical ? "" : undefined}
          data-testid={`bar-${task.id}`}
          style={
            {
              // Место по датам, и только по ним: `left` и `width` выставляются
              // на рендер и дальше не меняются никем. И сдвиг под пальцем, и
              // ожидание ответа на месте броска, и переезд после ответа
              // сервера идут через `transform` и `--bar-dw` — см. useBarMotion,
              // там же и о том, почему не через эти два.
              left,
              "--bar-w": `${width}px`,
              "--progress": `${task.progress_pct}%`,
            } as CSSProperties
          }
          {...handlers}
          // Наведение и жест живут на одних и тех же событиях, поэтому
          // обработчики сложены руками, а не наложены спредом: спред оставил бы
          // от каждой пары только последнюю.
          onPointerEnter={tip.onPointerEnter}
          onPointerMove={(event) => {
            handlers.onPointerMove(event);
            tip.onPointerMove(event);
          }}
          onPointerDown={(event) => {
            handlers.onPointerDown(event);
            tip.onPointerDown();
          }}
          onPointerUp={(event) => {
            handlers.onPointerUp(event);
            tip.onPointerUp();
          }}
          onPointerCancel={() => {
            handlers.onPointerCancel();
            tip.onPointerCancel();
          }}
          onPointerLeave={tip.onPointerLeave}
          onFocus={tip.onFocus}
          onBlur={tip.onBlur}
          // Имя названо явно вместе с датами, а не оставлено содержимому
          // кнопки: у полоски есть обрезаемый по ширине текст, и браузеры
          // расходятся в том, что из этого станет доступным именем. Живая
          // проверка показала полоску, которая читается с экрана как
          // «14 августа — 20 августа» — без названия задачи вовсе.
          //
          // Нативного `title` у полоски нет намеренно: поверх карточки
          // наведения через секунду вылезала бы вторая, браузерная, и об одном
          // и том же говорили бы два разных окна.
          aria-label={`${task.name}, ${title}`}
          // Сочетания названы вслух: сдвинуть задачу с клавиатуры можно было и
          // раньше, но узнать об этом — только из исходников. Читателю здесь
          // пусто: стрелки у него ничего не двигают, и обещать их значило бы
          // отправить его нажимать клавиши, которые молчат.
          aria-keyshortcuts={
            canWrite
              ? task.milestone
                // У вехи граней нет: тянуть нечего, и обещать сочетание,
                // которое молчит, значило бы отправить человека нажимать
                // клавиши впустую.
                ? "Shift+ArrowLeft Shift+ArrowRight"
                : "Shift+ArrowLeft Shift+ArrowRight Alt+ArrowLeft Alt+ArrowRight Shift+Alt+ArrowLeft Shift+Alt+ArrowRight"
              : undefined
          }
          aria-expanded={onSelect ? selected : undefined}
          onClick={() => onSelect?.(task.id)}
        >
          {task.milestone ? (
            // Веха — ромб в своём дне. Повёрнутый квадрат внутри полоски, а не
            // сама полоска: её `transform` занят движением, и второй поворот
            // на том же узле стёр бы сдвиг под пальцем.
            <span className="gantt__diamond" aria-hidden="true" />
          ) : (
            <>
              {/* Заливка внутри полоски, а не отдельная полоска рядом: прогресс —
                  это часть задачи, а не вторая задача под ней. */}
              <span className="gantt__progress" aria-hidden="true" />
              {/* Галочка готовой задачи — как в макете: знак «сделано» виден с
                  расстояния, на котором плашка статуса уже не читается. */}
              {task.status === "done" && (
                <span className="gantt__check" aria-hidden="true">
                  ✓
                </span>
              )}
              {/* Заблокированная называет своё состояние прямо на полоске: это
                  редкое и требующее действия состояние, и цвета одного мало. */}
              {task.status === "blocked" && statusLabel && (
                <span className="gantt__bar-blocked" aria-hidden="true">
                  <span>⚠</span>
                  {statusLabel}
                </span>
              )}

              {canWrite && (
                // Грани полоски: левая двигает начало, не трогая конца, правая
                // растягивает срок. Отдельными узлами, а не зонами внутри
                // общего обработчика: у каждой свой курсор, и зонами его
                // пришлось бы решать в момент нажатия — когда курсор уже
                // показал что-то одно.
                //
                // От чтения с экрана скрыты: то же, что они делают, доступно с
                // клавиатуры полями «Начало» и «Длительность» — и в таблице
                // слева, и в карточке задачи. Две ручки, ни одна из которых не
                // работает по Enter, были бы лишними шагами Tab на каждой из
                // сотни строк.
                <>
                  <span
                    className="gantt__grip gantt__grip--start"
                    aria-hidden="true"
                    {...gripHandlers("start")}
                  />
                  <span
                    className="gantt__grip gantt__grip--end"
                    aria-hidden="true"
                    {...gripHandlers("end")}
                  />
                </>
              )}

              {canWrite && task.status === "in_progress" && (
                // Ручка выполненного — только там, где заливка вообще видна.
                // У запланированной её нет: процент лёг бы в поле, а на
                // полоске не отразился, и жест выглядел бы сорвавшимся.
                <span
                  className="gantt__grip gantt__grip--progress"
                  aria-hidden="true"
                  {...gripHandlers("progress")}
                />
              )}
            </>
          )}
        </Bar>

        {link?.enabled && dragging === null && (
          // Кружки связи — снаружи полоски, а не внутри: у полоски обрезается
          // содержимое (иначе подпись вылезала бы за её края), и кружок на
          // границе срезало бы пополам.
          //
          // Пока полоску тащат, кружков нет: они стоят по датам задачи, а
          // полоска в этот момент идёт за пальцем, и кружки отставали бы от
          // неё, показывая связь не оттуда, откуда её тянут.
          <>
            <LinkDot
              side="start"
              task={task}
              link={link}
              x={left}
              label={t("gantt.link.from", { name: task.name })}
            />
            <LinkDot
              side="end"
              task={task}
              link={link}
              x={left + width}
              label={t("gantt.link.to", { name: task.name })}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Знак «обсуждение» — рисунком, а не эмодзи.
 *
 * Эмодзи рисуется цветной картинкой шрифта системы: в ряду тонких линий ленты
 * это наклейка, да ещё и разная на разных системах. Рисунок берёт цвет текста
 * и гаснет вместе с ним.
 */
function CommentIcon() {
  return (
    <svg className="gantt__glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M13.6 2.8H2.4a1 1 0 0 0-1 1v6.1a1 1 0 0 0 1 1h1.9v2.6l2.9-2.6h6.4a1 1 0 0 0 1-1V3.8a1 1 0 0 0-1-1Z" />
    </svg>
  );
}

/**
 * Кружок, от которого тянут связь.
 *
 * Не кнопка: связь заводится перетаскиванием, а нажатие Enter на ней не значит
 * ничего. Тот же путь с клавиатуры даёт список связей в карточке задачи —
 * поэтому кружок скрыт и от чтения с экрана, а подпись остаётся подсказкой
 * указателю.
 */
function LinkDot({
  side,
  task,
  link,
  x,
  label,
}: {
  side: "start" | "end";
  task: Task;
  link: LinkDrag;
  x: number;
  label: string;
}) {
  return (
    <span
      className={`gantt__link-dot gantt__link-dot--${side}`}
      style={{ left: x }}
      title={label}
      aria-hidden="true"
      {...link.handleProps(task.id, side)}
    />
  );
}

/**
 * Полоска задачи: орган управления или картинка с подписью.
 *
 * Различие не косметическое. Кнопка забирает фокус с клавиатуры и читается с
 * экрана как нажимаемая; на публичной странице, где карточки задачи нет и
 * даты не двигаются, это обещание действия, которого не существует. Тогда
 * полоска объявляется картинкой — `role="img"` с тем же именем: она
 * по-прежнему называет задачу и её даты, но не притворяется кнопкой.
 */
function Bar({
  interactive,
  children,
  barRef,
  ...rest
}: {
  interactive: boolean;
  children: ReactNode;
  /**
   * Ссылка на узел полоски для слоя движения.
   *
   * Отдельным пропсом, а не `ref`: `Bar` рисует то кнопку, то `div`, и `ref`
   * пришлось бы объявлять сразу для обоих — а он всё равно нужен не самому
   * `Bar`, а тому, кто в этот узел пишет.
   */
  barRef?: RefCallback<HTMLElement>;
} & HTMLAttributes<HTMLElement>) {
  if (interactive) {
    return (
      <button type="button" ref={barRef} {...rest}>
        {children}
      </button>
    );
  }
  // aria-expanded и onClick сюда не доходят: без onSelect они пусты, а пустой
  // обработчик на неинтерактивном элементе — след, который читается как забытая
  // возможность.
  const { onClick, "aria-expanded": expanded, ...plain } = rest;
  void onClick;
  void expanded;
  return (
    <div role="img" ref={barRef} {...plain}>
      {children}
    </div>
  );
}
