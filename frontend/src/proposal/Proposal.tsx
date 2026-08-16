import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import { projectQueryKey } from "../api/projects";
import {
  createProposalTask,
  deleteProposalCategory,
  getProposal,
  proposalQueryKey,
  pushProposalToPlan,
  updateProposalCategory,
  updateProposalSettings,
} from "../api/proposal";
import type { ProposalCategory, ProposalSettingsPatch, ProposalTask } from "../api/proposal";
import { SaveMark, SelectField, TextField, ValueField } from "../components/autosave";
import { useFieldSaves } from "../components/autosave";
import { ConfirmAction } from "../components/ConfirmAction";
import { useToast } from "../components/toast";
import { useLocale } from "../i18n/LocaleProvider";
import { formatAmount, formatMoney } from "./money";
import { NewProposalTaskRow } from "./NewProposalTaskRow";
import { ProposalCategoryForm } from "./ProposalCategoryForm";
import { ProposalTaskPanel } from "./ProposalTaskPanel";

import "./proposal.css";

/** Колонки таблицы: работа, описание, оценка, часы, ставка, цена. */
const COLUMNS = 6;

/**
 * Вкладка «Предложение»: смета проекта до плана.
 *
 * Одна таблица на все разделы, как в макете: раздел — строкой-заголовком со
 * сводкой своих работ, работы — строками под ним, итоги — карточкой справа.
 * Цена строки и все итоги считаются здесь, на экране: это произведение и
 * сумма уже показанных чисел, и сервер, пересказывающий их, был бы вторым
 * местом с той же арифметикой (см. api/proposal.ts).
 *
 * Разделы и строки заводятся теми же движениями, что категории и задачи в
 * ленте: раздел — окном из тулбара, строка — полем прямо в таблице, по
 * «плюсу» на строке раздела или кнопкой тулбара (см. NewProposalTaskRow).
 */
export function Proposal({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: proposalQueryKey(projectId),
    queryFn: () => getProposal(projectId),
    retry: false,
  });

  // Карточка строки — идентификатором, а не объектом: после каждой правки
  // состояние приходит с сервера заново, и карточка, помнящая объект,
  // показывала бы устаревшие данные. Тот же приём, что у карточки задачи.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  // Раздел, в котором открыта строка новой работы. `null` — закрыта.
  const [newTaskIn, setNewTaskIn] = useState<string | null>(null);
  // Свёрнутые разделы. Пустое множество — всё развёрнуто: смету читают
  // целиком, и прятать что-то по умолчанию не за чем.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [editingNotes, setEditingNotes] = useState(false);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: proposalQueryKey(projectId) });

  // Настройки и примечания сохраняют себя сами, как поля настроек проекта.
  const saves = useFieldSaves((patch: ProposalSettingsPatch) =>
    updateProposalSettings(projectId, patch).then(invalidate),
  );

  const addTask = useMutation({
    mutationFn: (input: { categoryId: string; name: string }) =>
      createProposalTask(projectId, input.categoryId, input.name),
    onSuccess: invalidate,
  });

  const removeCategory = useMutation({
    mutationFn: (categoryId: string) => deleteProposalCategory(projectId, categoryId),
    onSuccess: invalidate,
  });

  const patchCategory = useMutation({
    mutationFn: (input: { categoryId: string; description: string }) =>
      updateProposalCategory(projectId, input.categoryId, {
        description: input.description,
      }),
    onSuccess: invalidate,
  });

  const push = useMutation({
    mutationFn: () => pushProposalToPlan(projectId),
    onSuccess: async (result) => {
      toast({ message: t("proposal.push.done", { count: result.created_tasks }) });
      // Перенос рождает ревизии плана: перечитывается проект целиком, и
      // вложенный ключ сметы сбрасывается тем же вызовом.
      await queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
    },
    onError: (refusal: unknown) => {
      toast({ message: t(errorKey(refusal)), tone: "error" });
    },
  });

  if (query.isPending) {
    return <p role="status">{t("common.loading")}</p>;
  }

  if (query.error) {
    return (
      <p className="error" role="alert">
        {t(errorKey(query.error))}
      </p>
    );
  }

  const proposal = query.data;
  const tasks = proposal.categories.flatMap((category) => category.tasks);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const hours = proposal.effort_unit === "hours";

  // Оценка живёт в единице сметы, а показывается в обеих: колонка дней и
  // колонка часов пересчитываются через «часов в дне» — те же правила, по
  // которым перенос в план считает длительности.
  const toDays = (effort: number) => (hours ? effort / proposal.hours_per_day : effort);
  const toHours = (effort: number) => (hours ? effort : effort * proposal.hours_per_day);

  const days = (value: number) =>
    t("proposal.format.days", { value: formatAmount(locale, value) });
  const hoursLabel = (value: number) =>
    t("proposal.format.hours", { value: formatAmount(locale, value) });
  const money = (value: number) => formatMoney(locale, proposal.currency, value);
  // Ставка — за день или за час, и подпись обязана это говорить: голое
  // «$100» не отвечает на вопрос «за что».
  const rate = (value: number) =>
    t(hours ? "proposal.format.per_hour" : "proposal.format.per_day", {
      rate: money(value),
    });

  const subtotal = tasks.reduce((sum, task) => sum + task.effort * task.rate, 0);
  const tax = (subtotal * proposal.tax_rate_pct) / 100;
  const totalDays = tasks.reduce((sum, task) => sum + toDays(task.effort), 0);
  const totalHours = tasks.reduce((sum, task) => sum + toHours(task.effort), 0);

  const toggle = (categoryId: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });

  const createTask = (categoryId: string) => (name: string) =>
    addTask.mutate({ categoryId, name });

  return (
    <div className="proposal">
      <div className="proposal__main">
        <div className="proposal__toolbar">
          <div className="proposal__settings">
            <SelectField
              id="proposal-unit"
              label={t("proposal.settings.unit")}
              value={proposal.effort_unit}
              disabled={!canWrite}
              options={[
                { value: "days", label: t("proposal.settings.unit_days") },
                { value: "hours", label: t("proposal.settings.unit_hours") },
              ]}
              save={saves.at("unit")}
              onCommit={(value) =>
                saves.commit("unit", { effort_unit: value as "days" | "hours" })
              }
            />
            <ValueField
              id="proposal-hours-per-day"
              label={t("proposal.settings.hours_per_day")}
              type="number"
              value={String(proposal.hours_per_day)}
              disabled={!canWrite}
              resetToken={proposal.hours_per_day}
              save={saves.at("hours_per_day")}
              onCommit={(value) =>
                saves.commitNumber("hours_per_day", value, (hoursPerDay) => ({
                  hours_per_day: hoursPerDay,
                }))
              }
            />
            <ValueField
              id="proposal-tax"
              label={t("proposal.settings.tax_rate")}
              type="number"
              value={String(proposal.tax_rate_pct)}
              disabled={!canWrite}
              resetToken={proposal.tax_rate_pct}
              save={saves.at("tax")}
              onCommit={(value) =>
                saves.commitNumber("tax", value, (taxRate) => ({ tax_rate_pct: taxRate }))
              }
            />
            <TextField
              id="proposal-currency"
              label={t("proposal.settings.currency")}
              value={proposal.currency}
              disabled={!canWrite}
              resetToken={proposal.currency}
              save={saves.at("currency")}
              onCommit={(value) => {
                const code = value.trim().toUpperCase();
                // До сервера не доходит: код валюты — ровно три буквы, и
                // сказать об этом можно у поля, не спрашивая никого.
                if (!/^[A-Z]{3}$/.test(code)) {
                  saves.refuse("currency", "proposal.settings.currency_invalid");
                  return;
                }
                saves.commit("currency", { currency: code });
              }}
            />
          </div>
          {canWrite && (
            <div className="proposal__actions">
              {/* Тот же порядок, что в тулбаре ленты: сначала раздел, потом
                  строка — работу некуда класть, пока нет ни одного раздела,
                  и кнопка строки до первого раздела не показывается. Дальше
                  она открывает поле в первом разделе: положить работу в любой
                  другой — «плюс» на его строке. */}
              <button
                type="button"
                className="button--quiet"
                onClick={() => setAddingCategory(true)}
              >
                {t("proposal.category.create")}
              </button>
              {proposal.categories.length > 0 && (
                <button
                  type="button"
                  onClick={() => setNewTaskIn(proposal.categories[0].id)}
                >
                  {t("proposal.task.create")}
                </button>
              )}
            </div>
          )}
        </div>

        {proposal.categories.length === 0 ? (
          <p className="muted proposal__empty">{t("proposal.empty")}</p>
        ) : (
          <table className="proposal-table">
            <thead>
              <tr>
                <th>{t("proposal.columns.work_item")}</th>
                <th>{t("proposal.columns.description")}</th>
                <th className="proposal-table__num">{t("proposal.columns.effort")}</th>
                <th className="proposal-table__num">{t("proposal.columns.hours")}</th>
                <th className="proposal-table__num">{t("proposal.columns.rate")}</th>
                <th className="proposal-table__num">{t("proposal.columns.price")}</th>
              </tr>
            </thead>
            <tbody>
              {proposal.categories.map((category) => (
                <CategoryRows
                  key={category.id}
                  category={category}
                  open={!collapsed.has(category.id)}
                  canWrite={canWrite}
                  toDays={toDays}
                  toHours={toHours}
                  days={days}
                  hoursLabel={hoursLabel}
                  money={money}
                  rate={rate}
                  addingTask={newTaskIn === category.id}
                  onToggle={() => toggle(category.id)}
                  onAddTask={() => setNewTaskIn(category.id)}
                  onCloseNewTask={() => setNewTaskIn(null)}
                  onCreateTask={createTask(category.id)}
                  onDelete={() => removeCategory.mutate(category.id)}
                  onDescribe={(description) =>
                    patchCategory.mutate({ categoryId: category.id, description })
                  }
                  onOpenTask={(taskId) =>
                    // Повторный щелчок по той же строке закрывает карточку —
                    // тем же движением, что открыл. Как у карточки задачи.
                    setSelectedTaskId((current) => (current === taskId ? null : taskId))
                  }
                  t={t}
                />
              ))}
            </tbody>
          </table>
        )}

        {(addTask.error || removeCategory.error || patchCategory.error) && (
          <p className="error" role="alert">
            {t(errorKey(addTask.error ?? removeCategory.error ?? patchCategory.error))}
          </p>
        )}

        {/* Допущения и примечания — свойство предложения целиком, карточкой
            под таблицей: «оценки по текущему объёму», «ставки без лицензий»
            относятся ко всем строкам сразу. */}
        <section className="proposal-notes" aria-label={t("proposal.notes.title")}>
          <header className="proposal-notes__head">
            <h3 className="proposal-notes__title" id="proposal-notes-title">
              {t("proposal.notes.title")}
            </h3>
            <SaveMark save={saves.at("notes")} />
            {canWrite && !editingNotes && (
              <button
                type="button"
                className="button--quiet"
                onClick={() => setEditingNotes(true)}
              >
                {t("proposal.notes.edit")}
              </button>
            )}
          </header>
          {editingNotes ? (
            <NotesEditor
              initial={proposal.notes}
              onDone={(value) => {
                if (value !== proposal.notes) saves.commit("notes", { notes: value });
                setEditingNotes(false);
              }}
            />
          ) : proposal.notes.trim() === "" ? (
            <p className="muted">{t("proposal.notes.empty")}</p>
          ) : (
            // Пункт на строку, как их и пишут: маркеры даёт список, а не
            // разметка внутри текста.
            <ul className="proposal-notes__list">
              {proposal.notes
                .split("\n")
                .filter((line) => line.trim() !== "")
                .map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
            </ul>
          )}
        </section>
      </div>

      {/* Итоги — карточкой сбоку, на виду при любой прокрутке: «сколько
          всего» спрашивают, не дочитав смету. */}
      <aside className="proposal-summary" aria-label={t("proposal.summary.title")}>
        <h3 className="proposal-summary__title">{t("proposal.summary.title")}</h3>
        <dl>
          <div className="proposal-summary__row">
            <dt>{t("proposal.summary.total_hours")}</dt>
            <dd>{hoursLabel(totalHours)}</dd>
          </div>
          <div className="proposal-summary__row">
            <dt>{t("proposal.summary.total_duration")}</dt>
            <dd>{days(totalDays)}</dd>
          </div>
          <div className="proposal-summary__row proposal-summary__row--first">
            <dt>{t("proposal.summary.subtotal")}</dt>
            <dd>{money(subtotal)}</dd>
          </div>
          <div className="proposal-summary__row">
            <dt>{t("proposal.summary.tax", { rate: proposal.tax_rate_pct })}</dt>
            <dd>{money(tax)}</dd>
          </div>
          <div className="proposal-summary__row proposal-summary__total">
            <dt>
              {t("proposal.summary.total")}
              <span className="proposal-summary__currency">{proposal.currency}</span>
            </dt>
            <dd className="proposal-summary__amount">{money(subtotal + tax)}</dd>
          </div>
        </dl>
        {canWrite && (
          <button
            type="button"
            className="proposal-summary__push"
            disabled={tasks.length === 0 || push.isPending}
            onClick={() => push.mutate()}
          >
            {t("proposal.push.action")}
          </button>
        )}
      </aside>

      {selectedTask && (
        <ProposalTaskPanel
          projectId={projectId}
          task={selectedTask}
          effortUnit={proposal.effort_unit}
          currency={proposal.currency}
          canWrite={canWrite}
          onClose={() => setSelectedTaskId(null)}
        />
      )}

      {addingCategory && (
        <ProposalCategoryForm projectId={projectId} onClose={() => setAddingCategory(false)} />
      )}
    </div>
  );
}

/**
 * Раздел в таблице: строка-заголовок со сводкой и строки работ под ней.
 *
 * Сводка раздела — суммы его строк; ставка показывается, только когда она у
 * всех строк одна: среднее от разных ставок не значит ничего, а первое
 * попавшееся врёт.
 */
function CategoryRows({
  category,
  open,
  canWrite,
  toDays,
  toHours,
  days,
  hoursLabel,
  money,
  rate,
  addingTask,
  onToggle,
  onAddTask,
  onCloseNewTask,
  onCreateTask,
  onDelete,
  onDescribe,
  onOpenTask,
  t,
}: {
  category: ProposalCategory;
  open: boolean;
  canWrite: boolean;
  toDays: (effort: number) => number;
  toHours: (effort: number) => number;
  days: (value: number) => string;
  hoursLabel: (value: number) => string;
  money: (value: number) => string;
  rate: (value: number) => string;
  addingTask: boolean;
  onToggle: () => void;
  onAddTask: () => void;
  onCloseNewTask: () => void;
  onCreateTask: (name: string) => void;
  onDelete: () => void;
  onDescribe: (description: string) => void;
  onOpenTask: (taskId: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const categoryDays = category.tasks.reduce((sum, task) => sum + toDays(task.effort), 0);
  const categoryHours = category.tasks.reduce((sum, task) => sum + toHours(task.effort), 0);
  const categoryPrice = category.tasks.reduce(
    (sum, task) => sum + task.effort * task.rate,
    0,
  );
  const rates = new Set(category.tasks.map((task) => task.rate));
  const uniformRate = rates.size === 1 ? [...rates][0] : null;

  const toggleLabel = t(open ? "proposal.category.collapse" : "proposal.category.expand", {
    name: category.name,
  });

  return (
    <>
      <tr className="proposal-row proposal-row--category">
        <td>
          <span className="proposal-row__name">
            <button
              type="button"
              className="proposal-row__chevron"
              aria-expanded={open}
              aria-label={toggleLabel}
              title={toggleLabel}
              onClick={onToggle}
            >
              {open ? "▾" : "▸"}
            </button>
            {/* Имя раздела — содержимое пользователя: не переводится. */}
            <strong>{category.name}</strong>
            {canWrite && (
              // Подпись включает название раздела — на десятке разделов
              // безымянные «плюсы» при чтении с экрана неразличимы. Тот же
              // довод, что у «плюса» на строке категории в ленте.
              <button
                type="button"
                className="proposal-row__add"
                aria-label={t("proposal.category.add_task", { name: category.name })}
                title={t("proposal.category.add_task", { name: category.name })}
                onClick={onAddTask}
              >
                +
              </button>
            )}
            {canWrite && (
              <ConfirmAction
                className="button--quiet proposal-row__delete"
                label={t("proposal.category.delete")}
                warning={t("proposal.category.delete_warning", { name: category.name })}
                confirm={t("proposal.category.delete_confirm")}
                onConfirm={onDelete}
              />
            )}
          </span>
        </td>
        <td className="proposal-table__desc">
          {canWrite ? (
            // Описание правится на месте: у раздела нет карточки, и окно ради
            // одной строки было бы дороже самой строки.
            <DescriptionCell
              label={t("proposal.category.describe", { name: category.name })}
              value={category.description}
              onCommit={onDescribe}
            />
          ) : (
            category.description
          )}
        </td>
        <td className="proposal-table__num">{days(categoryDays)}</td>
        <td className="proposal-table__num">{hoursLabel(categoryHours)}</td>
        <td className="proposal-table__num muted">
          {uniformRate !== null && uniformRate > 0 ? rate(uniformRate) : ""}
        </td>
        <td className="proposal-table__num proposal-table__price">
          {money(categoryPrice)}
        </td>
      </tr>

      {open &&
        category.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            days={days}
            hoursLabel={hoursLabel}
            toDays={toDays}
            toHours={toHours}
            money={money}
            rate={rate}
            onOpen={() => onOpenTask(task.id)}
          />
        ))}

      {addingTask && (
        <NewProposalTaskRow
          columns={COLUMNS}
          label={t("proposal.task.new_label", { name: category.name })}
          placeholder={t("proposal.task.new_placeholder")}
          onCreate={onCreateTask}
          onClose={onCloseNewTask}
        />
      )}
    </>
  );
}

/**
 * Строка работы. Имя — кнопка, открывающая карточку: подробности, разговор и
 * заметки живут там, а таблица отвечает на «что, сколько и почём».
 */
function TaskRow({
  task,
  days,
  hoursLabel,
  toDays,
  toHours,
  money,
  rate,
  onOpen,
}: {
  task: ProposalTask;
  days: (value: number) => string;
  hoursLabel: (value: number) => string;
  toDays: (effort: number) => number;
  toHours: (effort: number) => number;
  money: (value: number) => string;
  rate: (value: number) => string;
  onOpen: () => void;
}) {
  return (
    <tr className="proposal-row proposal-row--task">
      <td>
        <span className="proposal-row__name proposal-row__name--task">
          <button type="button" className="proposal-table__open" onClick={onOpen}>
            {/* Имя строки — содержимое пользователя: не переводится. */}
            {task.name}
          </button>
          {task.comment_count > 0 && (
            <span className="proposal-table__comments">💬 {task.comment_count}</span>
          )}
        </span>
      </td>
      <td className="proposal-table__desc">{task.description}</td>
      <td className="proposal-table__num">{days(toDays(task.effort))}</td>
      <td className="proposal-table__num">{hoursLabel(toHours(task.effort))}</td>
      <td className="proposal-table__num muted">{task.rate > 0 ? rate(task.rate) : ""}</td>
      <td className="proposal-table__num">{money(task.effort * task.rate)}</td>
    </tr>
  );
}

/**
 * Правка примечаний: текст, по пункту на строку.
 *
 * Уход фокуса заканчивает правку в любом случае — изменённый текст уходит на
 * сервер, неизменённый просто закрывает поле: режим правки, из которого нет
 * выхода без изменения, читался бы как заевшая кнопка.
 */
function NotesEditor({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (value: string) => void;
}) {
  const [draft, setDraft] = useState(initial);

  return (
    <textarea
      className="proposal-notes__field"
      aria-labelledby="proposal-notes-title"
      rows={4}
      value={draft}
      // Фокус — сразу: «править» нажали ради того, чтобы писать.
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onDone(draft)}
    />
  );
}

/**
 * Описание раздела, которое правится на своей строке.
 *
 * То же правило, что у автосохраняемого текста (components/autosave): черновик
 * набирается локально, уходит по потере фокуса и только если изменился, а
 * значение сверху возвращает поле к правде после чужой правки.
 */
function DescriptionCell({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const shown = editing ? draft : value;

  return (
    <input
      className="proposal-table__input proposal-table__input--quiet"
      type="text"
      value={shown}
      aria-label={label}
      onFocus={() => {
        setDraft(value);
        setEditing(true);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}
