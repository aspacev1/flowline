import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import { MEMBERS_QUERY_KEY, members as fetchMembers } from "../api/org";
import { CRITICALITY_LEVELS, applyOp, projectQueryKey } from "../api/projects";
import type { Category, Criticality } from "../api/projects";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { toISO } from "../gantt/timescale";
import { useLocale } from "../i18n/LocaleProvider";

export function TaskForm({
  projectId,
  categories,
  initialCategoryId,
  onClose,
}: {
  projectId: string;
  categories: Category[];
  initialCategoryId: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [criticality, setCriticality] = useState<Criticality>("normal");
  const [startDate, setStartDate] = useState(() => toISO(Date.now()));
  const [durationDays, setDurationDays] = useState("1");
  const [assignees, setAssignees] = useState<string[]>([]);

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
        start_date: startDate,
        duration_days: Number(durationDays),
        criticality,
      });

      // Идентификатор новой задачи известен только из ответа сервера:
      // назначить исполнителей заранее, одной операцией, публичный контракт
      // не позволяет — и не должен, иначе клиент назначал бы идентификаторы.
      const taskId = revision.op?.task_id;
      if (typeof taskId === "string") {
        for (const userId of assignees) {
          await applyOp(projectId, { type: "assign_user", task_id: taskId, user_id: userId });
        }
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
      onClose();
    },
  });

  const days = Number(durationDays);
  const valid = name.trim() !== "" && startDate !== "" && Number.isInteger(days) && days >= 1;

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
