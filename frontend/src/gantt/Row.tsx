import type { Category, Task } from "../api/projects";
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
}: {
  category: Category;
  tasks: Task[];
  scale: Scale;
}) {
  const span =
    tasks.length === 0
      ? null
      : {
          start: tasks.reduce((a, t) => (t.start_date < a ? t.start_date : a), tasks[0].start_date),
          end: tasks.reduce((a, t) => (t.end_date > a ? t.end_date : a), tasks[0].end_date),
        };

  return (
    <div className="gantt__row gantt__row--category">
      <div className="gantt__label">
        <span className="gantt__dot" style={{ background: category.color }} aria-hidden="true" />
        <span className="gantt__label-name">{category.name}</span>
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
 * Полоска — кнопка, а не `div` с обработчиком: по ней будут кликать, и в
 * плане 3 по ней будут ходить с клавиатуры. Кнопка приносит фокус, роль и
 * реакцию на Enter даром; `div` пришлось бы доводить до того же руками и
 * забыть половину.
 */
export function TaskRow({
  task,
  scale,
  late,
  lateLabel,
  title,
}: {
  task: Task;
  scale: Scale;
  late: boolean;
  lateLabel: string;
  title: string;
}) {
  return (
    <div className="gantt__row">
      <div className="gantt__label">
        <span className="gantt__label-name">{task.name}</span>
        {late && (
          <span className="gantt__flag" title={lateLabel} role="img" aria-label={lateLabel}>
            !
          </span>
        )}
      </div>

      <div className="gantt__lane" style={{ width: scale.width }}>
        <button
          type="button"
          className={`gantt__bar${late ? " is-late" : ""}`}
          data-criticality={task.criticality}
          style={{
            left: scale.xOf(task.start_date),
            width: scale.widthOf(task.start_date, task.end_date),
          }}
          title={title}
        >
          {/* Заливка внутри полоски, а не отдельная полоска рядом: прогресс —
              это часть задачи, а не вторая задача под ней. */}
          <span
            className="gantt__progress"
            style={{ width: `${task.progress_pct}%` }}
            aria-hidden="true"
          />
          {task.name}
        </button>
      </div>
    </div>
  );
}
