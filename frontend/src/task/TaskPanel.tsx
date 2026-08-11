import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { errorKey } from "../api/errors";
import { MEMBERS_QUERY_KEY, members as fetchMembers } from "../api/org";
import { CRITICALITY_LEVELS } from "../api/projects";
import type { Criticality, Op, ProjectState, Task } from "../api/projects";
import { baselineOf, deviationDays, endShiftDays, isBeyondPlan } from "../project/baseline";
import { patchTask, reorderTask } from "../project/optimistic";
import { isShiftCancelled } from "../project/ShiftReason";
import { useProjectMutation } from "../project/useProjectMutation";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { SelectField, TextField, ValueField } from "./fields";
import { History } from "./History";

import "./panel.css";

/**
 * Карточка задачи.
 *
 * `complementary`, а не `dialog`: карточка не перекрывает диаграмму и не
 * забирает фокус — по ней и по ленте работают одновременно, сверяя полоску с
 * полями. Окно на её месте требовало бы закрывать себя перед каждым взглядом
 * на соседнюю задачу.
 *
 * Закрывается тремя способами, потому что к ней приходят тремя путями: мышью
 * за крестик, с клавиатуры по Esc и повторным щелчком по той же полоске —
 * последнее люди делают не задумываясь, и без этого щелчок выглядит
 * бездействием.
 */
export function TaskPanel({
  projectId,
  task,
  state,
  canWrite,
  onClose,
}: {
  projectId: string;
  task: Task;
  /** Весь проект: карточке нужны и категории, и соседи по ним. */
  state: ProjectState;
  canWrite: boolean;
  onClose: () => void;
}) {
  const categories = state.categories;
  const { t } = useLocale();
  const { apply } = useProjectMutation(projectId);
  const [error, setError] = useState<unknown>(null);
  // Счётчик отказов. Служит полям знаком «вернись к состоянию»: сравнивать
  // значения им недостаточно — догадка и откат часто укладываются в один кадр,
  // и с точки зрения поля значение не менялось.
  const [refusals, setRefusals] = useState(0);

  // Отказ здесь — не ошибка карточки: роль `client` состава организации не
  // получает вовсе, и блок исполнителей просто не рисуется. Тот же довод, что
  // и в форме создания задачи.
  const membersQuery = useQuery({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: fetchMembers,
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    // Слушатель на документе: к моменту нажатия фокус чаще всего на полоске, а
    // не внутри карточки, и слушатель на самой карточке молчал бы.
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const send = (op: Op, optimistic: (state: ProjectState) => ProjectState) => {
    setError(null);
    // Отказ уже откачен внутри `apply`: здесь остаётся объяснить его словами и
    // вернуть поле к тому, что осталось в состоянии.
    apply(op, optimistic).catch((refusal: unknown) => {
      // Отказ объяснять сдвиг — не ошибка: человек нажал «Вернуть», и поле
      // обязано вернуться к сохранённому значению молча. Сообщение об ошибке
      // здесь читалось бы как «что-то сломалось», хотя сломаться нечему.
      if (!isShiftCancelled(refusal)) setError(refusal);
      setRefusals((count) => count + 1);
    });
  };

  const patch = (fields: Partial<Task>) => (state: ProjectState) =>
    patchTask(state, task.id, fields);

  // Заметка — единственное поле с ограниченной видимостью, и `set_task_fields`
  // несёт все три текстовых поля разом. Значит, не видя заметки, послать эту
  // операцию нельзя: она стёрла бы её пустой строкой. По матрице прав такой
  // роли не существует — писать может лишь тот, кто заметку видит, — но
  // рассчитывать на совпадение двух списков прав не стоит.
  const editsText = canWrite && "internal_note" in task;

  const commitFields = (changed: Partial<Task>) => {
    const fields = {
      name: task.name,
      description: task.description ?? "",
      internal_note: task.internal_note ?? "",
      ...changed,
    };
    send({ type: "set_task_fields", task_id: task.id, ...fields }, patch(fields));
  };

  const toggleAssignee = (userId: string) => {
    const assigned = task.assignee_ids.includes(userId);
    send(
      {
        type: assigned ? "unassign_user" : "assign_user",
        task_id: task.id,
        user_id: userId,
      },
      patch({
        assignee_ids: assigned
          ? task.assignee_ids.filter((id) => id !== userId)
          : [...task.assignee_ids, userId],
      }),
    );
  };

  return (
    <aside
      className="panel"
      role="complementary"
      // Название задачи в подписи: карточек за сеанс открывают десяток, и
      // «дополнительная информация» без имени не говорит, о какой из них речь.
      aria-label={t("task.panel.aria", { name: task.name })}
    >
      <div className="panel__head">
        {/* Название задачи — содержимое пользователя: не переводится. */}
        <h2 className="panel__title">{task.name}</h2>
        <button
          type="button"
          className="panel__close"
          aria-label={t("task.panel.close")}
          title={t("task.panel.close")}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {error !== null && (
        <p className="error" role="alert">
          {t(errorKey(error))}
        </p>
      )}

      <Baseline task={task} state={state} />

      {/* `key` по задаче: переход к соседней начинает поля заново, а не доносит
          в новую карточку недописанный текст из прежней. */}
      <div key={task.id} className="panel__fields">
        <TextField
          id="panel-name"
          label={t("task.panel.name")}
          value={task.name}
          disabled={!editsText}
          resetToken={refusals}
          onCommit={(name) => commitFields({ name })}
        />

        <TextField
          id="panel-description"
          label={t("task.panel.description")}
          value={task.description ?? ""}
          rows={3}
          disabled={!editsText}
          resetToken={refusals}
          onCommit={(description) => commitFields({ description })}
        />

        <SelectField
          id="panel-category"
          label={t("task.panel.category")}
          value={task.category_id}
          disabled={!canWrite}
          // Название категории — содержимое пользователя: не переводится.
          options={categories.map((category) => ({
            value: category.id,
            label: category.name,
          }))}
          onCommit={(categoryId) => {
            // В конец выбранной категории: перенос списком — это смена
            // принадлежности, а не выбор места внутри. Место выбирают
            // перетаскиванием строки.
            const position = state.tasks.filter(
              (row) => row.category_id === categoryId && row.id !== task.id,
            ).length;
            send(
              { type: "reorder_task", task_id: task.id, category_id: categoryId, position },
              (state) => reorderTask(state, task.id, categoryId, position),
            );
          }}
        />

        <SelectField
          id="panel-criticality"
          label={t("task.panel.criticality")}
          value={task.criticality}
          disabled={!canWrite}
          options={CRITICALITY_LEVELS.map((level) => ({
            value: level,
            label: t(`task.criticality.${level}`),
          }))}
          onCommit={(value) => {
            const criticality = value as Criticality;
            send({ type: "set_criticality", task_id: task.id, criticality }, patch({ criticality }));
          }}
        />

        <ValueField
          id="panel-start"
          label={t("task.panel.start")}
          type="date"
          value={task.start_date}
          disabled={!canWrite}
          resetToken={refusals}
          onCommit={(start_date) =>
            send({ type: "move_task", task_id: task.id, start_date }, patch({ start_date }))
          }
        />

        <ValueField
          id="panel-duration"
          label={t("task.panel.duration")}
          type="number"
          value={String(task.duration_days)}
          disabled={!canWrite}
          resetToken={refusals}
          onCommit={(value) => {
            const duration_days = Number(value);
            send({ type: "set_duration", task_id: task.id, duration_days }, patch({ duration_days }));
          }}
        />

        <ValueField
          id="panel-progress"
          label={t("task.panel.progress")}
          type="number"
          value={String(task.progress_pct)}
          disabled={!canWrite}
          resetToken={refusals}
          onCommit={(value) => {
            const progress_pct = Number(value);
            send({ type: "set_progress", task_id: task.id, progress_pct }, patch({ progress_pct }));
          }}
        />

        <div className="panel__row">
          <span className="panel__key">{t("task.panel.end")}</span>
          {/* Дата окончания только показывается: её считает сервер по календарю
              проекта, и поле для правки обещало бы влияние, которого нет. */}
          <span className="panel__value">{formatShortDate(t, task.end_date)}</span>
        </div>

        {/* Единственное поле с ограниченной видимостью. Показывать его или нет,
            решает сервер: если заметки нет в ответе, блока нет в интерфейсе. */}
        {"internal_note" in task && (
          <TextField
            id="panel-note"
            label={t("task.panel.internal_note")}
            value={task.internal_note ?? ""}
            rows={3}
            disabled={!editsText}
          resetToken={refusals}
            onCommit={(internal_note) => commitFields({ internal_note })}
          />
        )}
      </div>

      {membersQuery.data && membersQuery.data.length > 0 && (
        <fieldset className="panel__field panel__fieldset">
          <legend>{t("task.panel.assignees")}</legend>
          <div className="panel__chips">
            {membersQuery.data.map((member) => (
              // Каждый исполнитель — своя операция: их и снимают по одному, и
              // в истории они читаются как отдельные события.
              <button
                key={member.id}
                type="button"
                className="panel__chip"
                aria-pressed={task.assignee_ids.includes(member.id)}
                disabled={!canWrite}
                onClick={() => toggleAssignee(member.id)}
              >
                {/* Имя человека — содержимое, а не чрома. */}
                {member.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <History projectId={projectId} taskId={task.id} />
    </aside>
  );
}

/**
 * Сводка отклонения от базового плана.
 *
 * Отдельным блоком наверху карточки, а не строкой среди полей: это не поле —
 * его нельзя править, и стоя между «датой старта» и «длительностью», оно
 * читалось бы как ещё одно значение, которое кто-то ввёл.
 *
 * Список переносов с причинами живёт ниже, в ленте истории: причина стоит
 * рядом со своим событием и датой, а второй список тех же событий здесь
 * означал бы два места, где одно и то же расходится.
 */
function Baseline({ task, state }: { task: Task; state: ProjectState }) {
  const { t } = useLocale();

  if (isBeyondPlan(state, task)) {
    return <p className="panel__baseline muted">{t("plan.beyond_plan_explained")}</p>;
  }

  const baseline = baselineOf(task);
  if (baseline === null) return null;

  const shift = endShiftDays(task);
  const deviation = deviationDays(task) ?? 0;

  return (
    <p className="panel__baseline">
      <span className="muted">
        {t("gantt.baseline", {
          from: formatShortDate(t, baseline.start),
          to: formatShortDate(t, baseline.end),
        })}
      </span>
      {shift !== null && shift !== 0 && (
        <span className={shift > 0 ? "panel__deviation is-late" : "panel__deviation is-early"}>
          {shift > 0
            ? t("gantt.deviation_late", { days: t("common.days", { count: shift }) })
            : t("gantt.deviation_early", { days: t("common.days", { count: -shift }) })}
        </span>
      )}
      {deviation > 0 && (
        <span className="muted">
          {t("plan.deviation_summary", { days: t("common.days", { count: deviation }) })}
        </span>
      )}
    </p>
  );
}
