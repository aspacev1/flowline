import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import type { Category, Task } from "../api/projects";
import { baselineOf, endShiftDays } from "../project/baseline";
import { useBarTip } from "./BarTip";
import { useDragDates } from "./useDragDates";
import { halfOf } from "./useReorder";
import type { Reorder } from "./useReorder";
import type { Scale } from "./timescale";

/**
 * Левая колонка — единственная ячейка задачи.
 *
 * Обёрнута в тот же `gantt__cell`, что и раньше держал три ячейки: сама
 * закреплённая колонка (`gantt__label`) от этого не меняется, меняется
 * только то, что в ней лежит.
 */
function LabelCells({ task }: { task: ReactNode }) {
  return <span className="gantt__cell gantt__cell--task">{task}</span>;
}

/**
 * Строка-заголовок категории: шеврон и название.
 *
 * Полоса рисуется по крайним датам содержимого, а не по отдельно хранимым
 * границам категории: вторых не существует, и заводить их значило бы держать
 * значение, которое обязано совпадать с задачами, но однажды разойдётся.
 */
export function CategoryRow({
  category,
  tasks,
  scale,
  addLabel,
  onAddTask,
  reorder,
  open = true,
  onToggle,
  toggleLabel,
}: {
  category: Category;
  tasks: Task[];
  scale: Scale;
  addLabel: string;
  onAddTask?: (categoryId: string) => void;
  reorder?: Reorder;
  /** Развёрнута ли категория: свёрнутая прячет свои строки задач. */
  open?: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
}) {
  const span =
    tasks.length === 0
      ? null
      : {
          start: tasks.reduce((a, t) => (t.start_date < a ? t.start_date : a), tasks[0].start_date),
          end: tasks.reduce((a, t) => (t.end_date > a ? t.end_date : a), tasks[0].end_date),
        };

  return (
    <div
      className={`gantt__row gantt__row--category ${reorder?.markFor("category", category.id) ?? ""}`.trimEnd()}
      // Заголовок категории — тоже цель броска: перенести задачу в другую
      // категорию иначе можно было бы только через список в карточке.
      onPointerMove={() => reorder?.over({ kind: "category", id: category.id, half: "bottom" })}
      onPointerUp={() => reorder?.drop()}
    >
      <div className="gantt__label">
        <LabelCells
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
            </>
          }
        />
      </div>

      <div className="gantt__lane" style={{ width: scale.width }}>
        {span && (
          <div
            className="gantt__span"
            style={{
              left: scale.xOf(span.start),
              width: scale.widthOf(span.start, span.end),
              background: category.color,
              // Тем же цветом красятся засечки-стрелки по краям полосы: они
              // рисуются рамкой на псевдоэлементах и берут его через
              // `currentColor` — второго места с цветом категории не заводим.
              color: category.color,
            }}
            aria-hidden="true"
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
  late,
  lateLabel,
  title,
  canWrite = false,
  selected = false,
  onSelect,
  reorder,
  handleLabel,
  beyondPlan = false,
  beyondPlanLabel,
  baselineLabel,
  deviationLabel,
  statusLabel,
  showBaseline = true,
}: {
  projectId: string;
  task: Task;
  scale: Scale;
  late: boolean;
  lateLabel: string;
  title: string;
  canWrite?: boolean;
  /** Открыта ли карточка этой задачи. */
  selected?: boolean;
  onSelect?: (taskId: string) => void;
  reorder?: Reorder;
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
}) {
  const { offset, handlers } = useDragDates({ projectId, task, scale, enabled: canWrite });
  const tip = useBarTip(task);
  const baseline = baselineOf(task);
  const shift = endShiftDays(task);

  return (
    <div
      className={`gantt__row${selected ? " is-selected" : ""} ${
        reorder?.markFor("task", task.id) ?? ""
      }`.trimEnd()}
      onPointerMove={(event) => reorder?.over({ kind: "task", id: task.id, half: halfOf(event) })}
      onPointerUp={() => reorder?.drop()}
    >
      <div className="gantt__label">
        <LabelCells
          task={
            <>
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
                  onPointerDown={(event) => {
                    // Без этого нажатие уводит фокус и начинает выделение текста
                    // вместо перетаскивания.
                    event.preventDefault();
                    reorder.start(task.id);
                  }}
                >
                  ⠿
                </span>
              )}
              <span className="gantt__label-name">{task.name}</span>
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
          className={`gantt__bar${late ? " is-late" : ""}${canWrite ? " is-draggable" : ""}${
            offset === 0 ? "" : " is-dragging"
          }`}
          data-criticality={task.criticality}
          data-status={task.status}
          style={
            {
              // Пока полоску тащат, она стоит там, где палец, — а не там, где
              // ей полагается по датам. Сами даты меняются только по ответу
              // сервера.
              left: scale.xOf(task.start_date) + offset,
              width: scale.widthOf(task.start_date, task.end_date),
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
          aria-expanded={onSelect ? selected : undefined}
          onClick={() => onSelect?.(task.id)}
        >
          {/* Заливка внутри полоски, а не отдельная полоска рядом: прогресс —
              это часть задачи, а не вторая задача под ней. */}
          <span
            className="gantt__progress"
            style={{ width: `${task.progress_pct}%` }}
            aria-hidden="true"
          />
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
        </Bar>
      </div>
    </div>
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
  ...rest
}: { interactive: boolean; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  if (interactive) {
    return (
      <button type="button" {...rest}>
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
    <div role="img" {...plain}>
      {children}
    </div>
  );
}
