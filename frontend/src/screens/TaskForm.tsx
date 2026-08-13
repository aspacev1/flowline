import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import { MEMBERS_QUERY_KEY, members as fetchMembers } from "../api/org";
import { CRITICALITY_LEVELS, TASK_STATUSES, applyOp, projectQueryKey } from "../api/projects";
import type { Category, Criticality, Task, TaskStatus } from "../api/projects";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { toISO } from "../gantt/timescale";
import { useLocale } from "../i18n/LocaleProvider";
import { progressForStatus, statusForProgress } from "../project/optimistic";

/**
 * Форма создания задачи.
 *
 * Набор полей повторяет карточку задачи, а не сокращает её: поле, которого
 * здесь нет, человек всё равно заполнит — сразу после создания, открыв
 * карточку, — и разница между двумя списками полей означала бы лишь, что
 * половину задачи заводят в два приёма. Исключение одно: дата окончания и
 * отклонение от базового плана — их считает сервер, и вводить их негде.
 *
 * Заметка показывается без проверки прав сознательно: форма открывается лишь
 * тому, кто может писать в проект, а по матрице прав всякий пишущий заметку и
 * читает. Карточка спрашивает об этом сервер (`internal_note` в ответе),
 * потому что она открывается и читателям тоже.
 */
export function TaskForm({
  projectId,
  categories,
  tasks,
  initialCategoryId,
  onClose,
}: {
  projectId: string;
  categories: Category[];
  /** Соседи по проекту: из них выбирают связи будущей задачи. */
  tasks: Task[];
  initialCategoryId: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [criticality, setCriticality] = useState<Criticality>("normal");
  const [status, setStatus] = useState<TaskStatus>("planned");
  const [progressPct, setProgressPct] = useState("0");
  const [startDate, setStartDate] = useState(() => toISO(Date.now()));
  const [durationDays, setDurationDays] = useState("1");
  const [assignees, setAssignees] = useState<string[]>([]);
  // Две стороны одной и той же связи: «зависит от» — где будущая задача
  // приёмник, «блокирует» — где источник. Хранятся списками чужих
  // идентификаторов: своего у задачи ещё нет.
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<string[]>([]);

  // Отказ здесь не считается ошибкой формы: роль `client` состава организации
  // не получает вовсе, и показывать ей «нет прав» посреди создания задачи
  // значило бы объяснять запрет, которого она не нарушала. Блок исполнителей
  // просто не рисуется.
  const membersQuery = useQuery({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: fetchMembers,
    retry: false,
    staleTime: Infinity,
  });

  const create = useMutation({
    mutationFn: async () => {
      const revision = await applyOp(projectId, {
        type: "create_task",
        category_id: categoryId,
        name: name.trim(),
        description: description.trim(),
        internal_note: internalNote.trim(),
        start_date: startDate,
        duration_days: Number(durationDays),
        criticality,
        status,
        progress_pct: Number(progressPct),
      });

      // Идентификатор новой задачи известен только из ответа сервера:
      // назначить исполнителей заранее, одной операцией, публичный контракт
      // не позволяет — и не должен, иначе клиент назначал бы идентификаторы.
      const taskId = revision.op?.task_id;
      if (typeof taskId === "string") {
        for (const userId of assignees) {
          await applyOp(projectId, { type: "assign_user", task_id: taskId, user_id: userId });
        }
        // Связи — по той же причине и тем же порядком: у связи два конца, и
        // один из них рождается только этим ответом.
        for (const otherId of dependsOn) {
          await applyOp(projectId, {
            type: "add_dependency",
            from_task_id: otherId,
            to_task_id: taskId,
          });
        }
        for (const otherId of blocks) {
          await applyOp(projectId, {
            type: "add_dependency",
            from_task_id: taskId,
            to_task_id: otherId,
          });
        }
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
      onClose();
    },
  });

  // Сцепка статуса и прогресса — та же, что на сервере и в карточке. При
  // создании сервер её не применяет: `create_task` кладёт оба поля такими,
  // какими их прислали. Значит, свести их обязана форма — иначе новая задача
  // рождается «готовой» с нулём процентов, то есть в состоянии, которого
  // правкой уже не получить.
  const chooseStatus = (next: TaskStatus) => {
    setStatus(next);
    setProgressPct(String(progressForStatus(next, Number(progressPct) || 0)));
  };

  const choosePct = (value: string) => {
    setProgressPct(value);
    // Пустое поле и середина набора статуса не касаются: он поедет за
    // числом, когда число станет числом.
    const pct = Number(value);
    if (value !== "" && Number.isInteger(pct) && pct >= 0 && pct <= 100) {
      setStatus(statusForProgress(status, pct));
    }
  };

  const days = Number(durationDays);
  const pct = Number(progressPct);
  const valid =
    name.trim() !== "" &&
    startDate !== "" &&
    Number.isInteger(days) &&
    days >= 1 &&
    progressPct !== "" &&
    Number.isInteger(pct) &&
    pct >= 0 &&
    pct <= 100;

  return (
    <Modal title={t("task.new.title")} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Field id="task-name" label={t("task.new.name")} value={name} onChange={setName} />

        <p className="field">
          <label htmlFor="task-description">{t("task.new.description")}</label>
          <textarea
            id="task-description"
            name="task-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </p>

        <p className="field">
          <label htmlFor="task-status">{t("task.new.status")}</label>
          <select
            id="task-status"
            name="task-status"
            value={status}
            onChange={(event) => chooseStatus(event.target.value as TaskStatus)}
          >
            {TASK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`task.status.${value}`)}
              </option>
            ))}
          </select>
        </p>

        <p className="field">
          <label htmlFor="task-category">{t("task.new.category")}</label>
          <select
            id="task-category"
            name="task-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {categories.map((category) => (
              // Название категории — содержимое пользователя: оно не
              // переводится ни при каком языке интерфейса.
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </p>

        <p className="field">
          <label htmlFor="task-criticality">{t("task.new.criticality")}</label>
          <select
            id="task-criticality"
            name="task-criticality"
            value={criticality}
            onChange={(event) => setCriticality(event.target.value as Criticality)}
          >
            {CRITICALITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {t(`task.criticality.${level}`)}
              </option>
            ))}
          </select>
        </p>

        <Field
          id="task-start"
          label={t("task.new.start")}
          type="date"
          value={startDate}
          onChange={setStartDate}
        />

        {/* Подпись говорит «рабочих дней», а не «дней»: это разные величины, и
            человек, поставивший 5 в пятницу, должен понимать, почему задача
            кончается в четверг, а не в следующий вторник. */}
        <Field
          id="task-duration"
          label={t("task.new.duration")}
          type="number"
          value={durationDays}
          onChange={setDurationDays}
        />

        <Field
          id="task-progress"
          label={t("task.new.progress")}
          type="number"
          value={progressPct}
          onChange={choosePct}
        />

        <p className="field">
          <label htmlFor="task-note">{t("task.new.internal_note")}</label>
          <textarea
            id="task-note"
            name="task-note"
            rows={3}
            value={internalNote}
            onChange={(event) => setInternalNote(event.target.value)}
          />
        </p>

        {tasks.length > 0 && (
          <div className="links">
            <LinkPicker
              label={t("task.new.depends_on")}
              tasks={tasks}
              chosen={dependsOn}
              opposite={blocks}
              onAdd={(id) => setDependsOn((current) => [...current, id])}
              onRemove={(id) => setDependsOn((current) => current.filter((row) => row !== id))}
            />
            <LinkPicker
              label={t("task.new.blocks")}
              tasks={tasks}
              chosen={blocks}
              opposite={dependsOn}
              onAdd={(id) => setBlocks((current) => [...current, id])}
              onRemove={(id) => setBlocks((current) => current.filter((row) => row !== id))}
            />
          </div>
        )}

        {membersQuery.data && membersQuery.data.length > 0 && (
          <fieldset className="field fieldset">
            <legend>{t("task.new.assignees")}</legend>
            {membersQuery.data.map((member) => (
              <label key={member.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={assignees.includes(member.id)}
                  onChange={(event) =>
                    setAssignees((current) =>
                      event.target.checked
                        ? [...current, member.id]
                        : current.filter((id) => id !== member.id),
                    )
                  }
                />
                {/* Имя человека — содержимое, а не чрома. */}
                {member.name}
              </label>
            ))}
          </fieldset>
        )}

        {create.error && (
          <p className="error" role="alert">
            {t(errorKey(create.error))}
          </p>
        )}

        <div className="modal__actions">
          <button type="submit" disabled={!valid || create.isPending}>
            {t("task.new.submit")}
          </button>
          <button type="button" className="button--quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Одна сторона связей: выбранные задачи плашками и список «добавить связь…».
 *
 * Тот же жест, что и в карточке, — намеренно: связи, заведённые при создании,
 * снимают потом уже там, и второй способ выбирать то же самое пришлось бы
 * объяснять заново.
 */
function LinkPicker({
  label,
  tasks,
  chosen,
  opposite,
  onAdd,
  onRemove,
}: {
  label: string;
  tasks: Task[];
  chosen: string[];
  /** Выбранное на обратной стороне: оттуда кандидаты не берутся. */
  opposite: string[];
  onAdd: (taskId: string) => void;
  onRemove: (taskId: string) => void;
}) {
  const { t } = useLocale();
  const nameOf = new Map(tasks.map((row) => [row.id, row.name]));
  // Кандидаты без уже выбранных и без обратной стороны: A→B вместе с B→A —
  // это цикл, и предлагать его значило бы предлагать отказ сервера.
  const candidates = tasks.filter(
    (row) => !chosen.includes(row.id) && !opposite.includes(row.id),
  );

  return (
    <div className="field links__row">
      <span className="links__label">{label}</span>
      <span className="links__list">
        {chosen.map((taskId) => (
          <span key={taskId} className="links__item">
            {/* Название задачи — содержимое пользователя: не переводится. */}
            {nameOf.get(taskId) ?? taskId}
            <button
              type="button"
              className="links__remove"
              aria-label={t("task.new.unlink", { name: nameOf.get(taskId) ?? taskId })}
              title={t("task.new.unlink", { name: nameOf.get(taskId) ?? taskId })}
              onClick={() => onRemove(taskId)}
            >
              ×
            </button>
          </span>
        ))}
        {candidates.length > 0 && (
          // Значение всегда пустое: это не выбор состояния, а команда
          // «добавить связь», и после неё список обязан вернуться к подсказке.
          <select
            className="links__add"
            value=""
            aria-label={t("task.new.add_link_to", { label })}
            onChange={(event) => {
              if (event.target.value === "") return;
              onAdd(event.target.value);
            }}
          >
            <option value="">{t("task.new.add_link")}</option>
            {candidates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        )}
      </span>
    </div>
  );
}
