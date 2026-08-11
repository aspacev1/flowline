import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { MEMBERS_QUERY_KEY, members as fetchMembers } from "../api/org";
import { CRITICALITY_LEVELS } from "../api/projects";
import type { Category, Criticality, Task } from "../api/projects";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";

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
  task,
  categories,
  onClose,
}: {
  task: Task;
  categories: Category[];
  onClose: () => void;
}) {
  const { t } = useLocale();

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

      <TaskFields key={task.id} task={task} categories={categories} />

      <div className="panel__row">
        <span className="panel__key">{t("task.panel.end")}</span>
        {/* Дата окончания только показывается: её считает сервер по календарю
            проекта, и поле для правки обещало бы влияние, которого нет. */}
        <span className="panel__value">{formatShortDate(t, task.end_date)}</span>
      </div>

      {membersQuery.data && membersQuery.data.length > 0 && (
        <fieldset className="panel__field panel__fieldset">
          <legend>{t("task.panel.assignees")}</legend>
          <div className="panel__chips">
            {membersQuery.data.map((member) => (
              <button
                key={member.id}
                type="button"
                className="panel__chip"
                aria-pressed={task.assignee_ids.includes(member.id)}
              >
                {/* Имя человека — содержимое, а не чрома. */}
                {member.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </aside>
  );
}

/**
 * Поля карточки.
 *
 * Вынесены отдельным компонентом ради `key={task.id}`: при переходе к соседней
 * задаче состояние полей обязано начаться заново, а не донести в новую карточку
 * недописанный текст из прежней.
 */
function TaskFields({ task, categories }: { task: Task; categories: Category[] }) {
  const { t } = useLocale();

  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description ?? "");
  const [note, setNote] = useState(task.internal_note ?? "");
  const [progress, setProgress] = useState(String(task.progress_pct));
  const [categoryId, setCategoryId] = useState(task.category_id);
  const [criticality, setCriticality] = useState<Criticality>(task.criticality);
  const [start, setStart] = useState(task.start_date);
  const [duration, setDuration] = useState(String(task.duration_days));

  return (
    <>
      <p className="panel__field">
        <label htmlFor="panel-name">{t("task.panel.name")}</label>
        <input
          id="panel-name"
          name="panel-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </p>

      <p className="panel__field">
        <label htmlFor="panel-description">{t("task.panel.description")}</label>
        <textarea
          id="panel-description"
          name="panel-description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </p>

      <p className="panel__field">
        <label htmlFor="panel-category">{t("task.panel.category")}</label>
        <select
          id="panel-category"
          name="panel-category"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </p>

      <p className="panel__field">
        <label htmlFor="panel-criticality">{t("task.panel.criticality")}</label>
        <select
          id="panel-criticality"
          name="panel-criticality"
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

      <p className="panel__field">
        <label htmlFor="panel-start">{t("task.panel.start")}</label>
        <input
          id="panel-start"
          name="panel-start"
          type="date"
          value={start}
          onChange={(event) => setStart(event.target.value)}
        />
      </p>

      <p className="panel__field">
        <label htmlFor="panel-duration">{t("task.panel.duration")}</label>
        <input
          id="panel-duration"
          name="panel-duration"
          type="number"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
        />
      </p>

      <p className="panel__field">
        <label htmlFor="panel-progress">{t("task.panel.progress")}</label>
        <input
          id="panel-progress"
          name="panel-progress"
          type="number"
          value={progress}
          onChange={(event) => setProgress(event.target.value)}
        />
      </p>

      {/* Единственное поле с ограниченной видимостью. Показывать его или нет,
          решает сервер: если заметки нет в ответе, блока нет в интерфейсе. */}
      {"internal_note" in task && (
        <p className="panel__field">
          <label htmlFor="panel-note">{t("task.panel.internal_note")}</label>
          <textarea
            id="panel-note"
            name="panel-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </p>
      )}
    </>
  );
}
