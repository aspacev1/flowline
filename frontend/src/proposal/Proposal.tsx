import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import { projectQueryKey } from "../api/projects";
import {
  createProposalCategory,
  createProposalTask,
  deleteProposalCategory,
  getProposal,
  proposalQueryKey,
  pushProposalToPlan,
  updateProposalSettings,
} from "../api/proposal";
import type { ProposalSettingsPatch, ProposalTask } from "../api/proposal";
import { SelectField, TextField, ValueField } from "../components/autosave";
import { useFieldSaves } from "../components/autosave";
import { ConfirmAction } from "../components/ConfirmAction";
import { useToast } from "../components/toast";
import { useLocale } from "../i18n/LocaleProvider";
import { formatAmount, formatMoney } from "./money";
import { ProposalTaskPanel } from "./ProposalTaskPanel";

import "./proposal.css";

/**
 * Вкладка «Предложение»: смета проекта до плана.
 *
 * Разделы со строками — слева, итоги — карточкой справа. Цена строки и все
 * итоги считаются здесь, на экране: это произведение и сумма уже показанных
 * чисел, и сервер, пересказывающий их, был бы вторым местом с той же
 * арифметикой (см. api/proposal.ts).
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
  const [newCategory, setNewCategory] = useState("");
  // Черновики имён новых строк — по разделу: форма стоит под каждым.
  const [newTask, setNewTask] = useState<Record<string, string>>({});

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: proposalQueryKey(projectId) });

  // Настройки сохраняют себя сами, как поля настроек проекта: у сметы нет
  // кнопки «Сохранить», и ответ сервера стоит у каждого поля своей отметкой.
  const saves = useFieldSaves((patch: ProposalSettingsPatch) =>
    updateProposalSettings(projectId, patch).then(invalidate),
  );

  const addCategory = useMutation({
    mutationFn: (name: string) => createProposalCategory(projectId, name),
    onSuccess: async () => {
      setNewCategory("");
      await invalidate();
    },
  });

  const addTask = useMutation({
    mutationFn: (input: { categoryId: string; name: string }) =>
      createProposalTask(projectId, input.categoryId, input.name),
    onSuccess: async (created) => {
      setNewTask((drafts) => ({ ...drafts, [created.category_id]: "" }));
      await invalidate();
    },
  });

  const removeCategory = useMutation({
    mutationFn: (categoryId: string) => deleteProposalCategory(projectId, categoryId),
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

  const effortTotal = tasks.reduce((sum, task) => sum + task.effort, 0);
  const subtotal = tasks.reduce((sum, task) => sum + task.effort * task.rate, 0);
  const tax = (subtotal * proposal.tax_rate_pct) / 100;
  const money = (value: number) => formatMoney(locale, proposal.currency, value);
  const hours = proposal.effort_unit === "hours";

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
            {/* Часы в дне спрашиваются только у почасовой сметы: план мерит
                днями, и без этого числа часы не во что перевести. */}
            {hours && (
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
            )}
            <ValueField
              id="proposal-tax"
              label={t("proposal.settings.tax_rate")}
              type="number"
              value={String(proposal.tax_rate_pct)}
              disabled={!canWrite}
              resetToken={proposal.tax_rate_pct}
              save={saves.at("tax")}
              onCommit={(value) =>
                saves.commitNumber("tax", value, (rate) => ({ tax_rate_pct: rate }))
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
              {/* Перенос — главное действие вкладки: смета пишется, чтобы
                  стать планом. Пустой смете переносить нечего. */}
              <button
                type="button"
                disabled={tasks.length === 0 || push.isPending}
                onClick={() => push.mutate()}
              >
                {t("proposal.push.action")}
              </button>
            </div>
          )}
        </div>

        {proposal.categories.length === 0 && (
          <p className="muted proposal__empty">{t("proposal.empty")}</p>
        )}

        {proposal.categories.map((category) => (
          <section key={category.id} className="proposal-category" aria-label={category.name}>
            <header className="proposal-category__head">
              {/* Имя раздела — содержимое пользователя: не переводится. */}
              <h3 className="proposal-category__name">{category.name}</h3>
              {canWrite && (
                <ConfirmAction
                  className="button--quiet proposal-category__delete"
                  label={t("proposal.category.delete")}
                  warning={t("proposal.category.delete_warning", { name: category.name })}
                  confirm={t("proposal.category.delete_confirm")}
                  onConfirm={() => removeCategory.mutate(category.id)}
                />
              )}
            </header>

            {category.tasks.length === 0 ? (
              <p className="muted">{t("proposal.category.empty")}</p>
            ) : (
              <table className="proposal-table">
                <thead>
                  <tr>
                    <th>{t("proposal.columns.task")}</th>
                    <th>{t("proposal.columns.description")}</th>
                    <th>{t("proposal.columns.role")}</th>
                    <th className="proposal-table__num">
                      {hours
                        ? t("proposal.columns.effort_hours")
                        : t("proposal.columns.effort_days")}
                    </th>
                    <th className="proposal-table__num">{t("proposal.columns.rate")}</th>
                    <th className="proposal-table__num">{t("proposal.columns.price")}</th>
                  </tr>
                </thead>
                <tbody>
                  {category.tasks.map((task) => (
                    <ProposalRow
                      key={task.id}
                      task={task}
                      locale={locale}
                      money={money}
                      onOpen={() =>
                        // Повторный щелчок по той же строке закрывает карточку —
                        // тем же движением, что открыл. Как у карточки задачи.
                        setSelectedTaskId((current) =>
                          current === task.id ? null : task.id,
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
            )}

            {canWrite && (
              <form
                className="proposal-add"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = (newTask[category.id] ?? "").trim();
                  if (name === "") return;
                  addTask.mutate({ categoryId: category.id, name });
                }}
              >
                <input
                  aria-label={t("proposal.task.name")}
                  placeholder={t("proposal.task.name")}
                  value={newTask[category.id] ?? ""}
                  onChange={(event) =>
                    setNewTask((drafts) => ({ ...drafts, [category.id]: event.target.value }))
                  }
                />
                <button
                  type="submit"
                  className="button--quiet"
                  disabled={(newTask[category.id] ?? "").trim() === "" || addTask.isPending}
                >
                  {t("proposal.task.add")}
                </button>
              </form>
            )}
          </section>
        ))}

        {canWrite && (
          <form
            className="proposal-add"
            onSubmit={(event) => {
              event.preventDefault();
              const name = newCategory.trim();
              if (name === "") return;
              addCategory.mutate(name);
            }}
          >
            <input
              aria-label={t("proposal.category.name")}
              placeholder={t("proposal.category.name")}
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
            />
            <button
              type="submit"
              className="button--quiet"
              disabled={newCategory.trim() === "" || addCategory.isPending}
            >
              {t("proposal.category.add")}
            </button>
          </form>
        )}

        {(addCategory.error || addTask.error || removeCategory.error) && (
          <p className="error" role="alert">
            {t(errorKey(addCategory.error ?? addTask.error ?? removeCategory.error))}
          </p>
        )}
      </div>

      {/* Итоги — карточкой сбоку, на виду при любой прокрутке: «сколько
          всего» спрашивают, не дочитав смету. */}
      <section className="proposal-summary" aria-label={t("proposal.summary.title")}>
        <h3 className="proposal-summary__title">{t("proposal.summary.title")}</h3>
        <dl>
          <div className="proposal-summary__row">
            <dt>
              {hours ? t("proposal.summary.total_hours") : t("proposal.summary.total_days")}
            </dt>
            <dd>{formatAmount(locale, effortTotal)}</dd>
          </div>
          <div className="proposal-summary__row">
            <dt>{t("proposal.summary.subtotal")}</dt>
            <dd>{money(subtotal)}</dd>
          </div>
          <div className="proposal-summary__row">
            <dt>{t("proposal.summary.tax", { rate: proposal.tax_rate_pct })}</dt>
            <dd>{money(tax)}</dd>
          </div>
          <div className="proposal-summary__row proposal-summary__total">
            <dt>{t("proposal.summary.total")}</dt>
            <dd>{money(subtotal + tax)}</dd>
          </div>
        </dl>
      </section>

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
    </div>
  );
}

/**
 * Строка сметы. Имя — кнопка, открывающая карточку: подробности, разговор и
 * заметки живут там, а таблица отвечает на «что, кто и почём».
 */
function ProposalRow({
  task,
  locale,
  money,
  onOpen,
}: {
  task: ProposalTask;
  locale: string;
  money: (value: number) => string;
  onOpen: () => void;
}) {
  return (
    <tr>
      <td>
        <button type="button" className="proposal-table__open" onClick={onOpen}>
          {/* Имя строки — содержимое пользователя: не переводится. */}
          {task.name}
        </button>
        {task.comment_count > 0 && (
          <span className="proposal-table__comments">💬 {task.comment_count}</span>
        )}
      </td>
      <td className="proposal-table__desc">{task.description}</td>
      <td>{task.role}</td>
      <td className="proposal-table__num">{formatAmount(locale, task.effort)}</td>
      <td className="proposal-table__num">{money(task.rate)}</td>
      <td className="proposal-table__num">{money(task.effort * task.rate)}</td>
    </tr>
  );
}
