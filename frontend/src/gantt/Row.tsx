import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import type { Category, Task } from "../api/projects";
import { baselineOf, endShiftDays } from "../project/baseline";
import { useDragDates } from "./useDragDates";
import { halfOf } from "./useReorder";
import type { Reorder } from "./useReorder";
import type { Scale } from "./timescale";

/**
 * Строка-заголовок категории: цветная точка, название и полоса, охватывающая
 * даты её задач.
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
  countLabel,
  progressLabel,
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
  /** «3 задачи» — счётчик рядом с названием, как в макете. */
  countLabel?: string;
  /** Aggregate completion shown in the fixed Status column. */
  progressLabel?: string;
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
        <div className="gantt__task-cell">
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
          <span className="gantt__dot" style={{ background: category.color }} aria-hidden="true" />
          <span className="gantt__label-name">{category.name}</span>
          {countLabel && <span className="gantt__count">{countLabel}</span>}
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
        </div>
        <div className="gantt__owner-cell" aria-hidden="true">—</div>
        <div className="gantt__status-cell gantt__status-cell--progress">{progressLabel}</div>
      </div>

      <div className="gantt__lane" style={{ width: scale.width }}>
        {span && (
          <div
            className="gantt__span"
            style={{
              left: scale.xOf(span.start),
              width: scale.widthOf(span.start, span.end),
              background: category.color,
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
  today,
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
  blockerPill,
  blockerTitle,
  waitsPill,
  assigneeNames = [],
  statusLabel,
}: {
  projectId: string;
  task: Task;
  scale: Scale;
  /** Сегодняшний день по ISO — от него считается статус «запланировано». */
  today: string;
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
  /** Пилюля «блокер»: задача, которой ждут другие. */
  blockerPill?: string;
  /** Подсказка к пилюле: кого именно эта задача держит. */
  blockerTitle?: string;
  /** Пилюля «ждёт: имя» у задачи-приёмника связи. */
  waitsPill?: string;
  /** Human-readable owners for the fixed Owner column. */
  assigneeNames?: string[];
  /** Localized computed status for the fixed Status column. */
  statusLabel?: string;
}) {
  const { offset, handlers } = useDragDates({ projectId, task, scale, enabled: canWrite });
  const baseline = baselineOf(task);
  const shift = endShiftDays(task);

  // Статус — вычисляется, а не хранится: «готово» — это стопроцентный
  // прогресс, «запланировано» — старт в будущем, остальное — «в работе».
  // Отдельное поле статуса рассинхронизировалось бы с этими двумя при первой
  // же правке дат или прогресса.
  const status =
    task.progress_pct >= 100 ? "done" : task.start_date > today ? "planned" : "active";

  return (
    <div
      className={`gantt__row${selected ? " is-selected" : ""} ${
        reorder?.markFor("task", task.id) ?? ""
      }`.trimEnd()}
      onPointerMove={(event) => reorder?.over({ kind: "task", id: task.id, half: halfOf(event) })}
      onPointerUp={() => reorder?.drop()}
    >
      <div className="gantt__label">
        <div className="gantt__task-cell">
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
          {blockerPill && (
          // Пилюля «блокер» — рядом с названием, как в макете Broadsheet: кого
          // именно держит задача, видно из подсказки и из стрелок.
          <span className="gantt__pill gantt__pill--blocker" title={blockerTitle}>
            {blockerPill}
          </span>
          )}
          {waitsPill && (
          <span className="gantt__pill" title={waitsPill}>
            {waitsPill}
          </span>
          )}
          {shift !== null && shift > 0 && deviationLabel && (
          // «+N дн.» и в левой колонке тоже, как в макете: сдвиг виден и там,
          // где полоска уехала за горизонт прокрутки.
          <span className="gantt__pill gantt__pill--late" title={baselineLabel}>
            {deviationLabel}
          </span>
          )}
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
        </div>
        <div className="gantt__owner-cell">
          {assigneeNames.length === 0 ? (
            <span className="gantt__owner-empty">—</span>
          ) : (
            <span className="gantt__avatars" title={assigneeNames.join(", ")}>
              {assigneeNames.slice(0, 3).map((name, index) => (
                <span className="gantt__avatar" key={`${name}-${index}`} aria-label={name}>
                  {initials(name)}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="gantt__status-cell">
          <span
            className="gantt__status"
            data-status={status}
            data-criticality={task.criticality}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="gantt__lane" style={{ width: scale.width }}>
{baseline && (
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

        {baseline && shift !== null && shift > 0 && (
          // Засечка первоначального дедлайна, как в макете: вертикальная
          // магентовая черта там, где задача должна была кончиться по плану.
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
          data-status={status}
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
          // Имя названо явно вместе с датами, а не оставлено содержимому
          // кнопки: у полоски есть и `title`, и обрезаемый по ширине текст, и
          // браузеры расходятся в том, что из этого станет доступным именем.
          // Живая проверка показала полоску, которая читается с экрана как
          // «14 августа — 20 августа» — без названия задачи вовсе.
          aria-label={`${task.name}, ${title}`}
          title={title}
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
          {/* Название — в отдельном узле: в макете полоска нема, имя живёт в
              левой колонке, и тема прячет этот узел, не трогая доступное имя
              кнопки (оно задано aria-label выше). */}
          <span className="gantt__bar-name">{task.name}</span>
        </Bar>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => [...part][0] ?? "").join("").toUpperCase();
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
