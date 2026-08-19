import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import { MEMBERS_QUERY_KEY, members } from "../api/org";
import {
  getScorecard,
  recalculateScorecard,
  scorecardMetricTasks,
  scorecardQueryKey,
  scorecardTasksQueryKey,
  updateScorecardMetric,
} from "../api/scorecard";
import type {
  ScorecardAlert,
  ScorecardMetric,
  ScorecardMetricPatch,
  ScorecardState,
  ScorecardTaskEntry,
} from "../api/scorecard";
import { Avatar } from "../components/Avatar";
import { useToast } from "../components/toast";
import { formatShortDate, formatTime } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { useLiveBlocksEditing } from "../live/LiveProvider";
import { formatAmount } from "../proposal/money";

import "./scorecard.css";

/**
 * Вкладка «Scorecard»: недельная панель здоровья проекта.
 *
 * Таблица метрик слева, «Требует внимания» и качество данных справа — как в
 * макете. Значения приходят с сервера посчитанными, экран их только рисует:
 * формулы метрик живут в одном месте (backend/app/scorecard.py), и клиент,
 * пересчитывающий их, был бы вторым местом с той же арифметикой.
 *
 * Метрика `daily_health` в таблице не показывается, пока отвечает `no_data`:
 * модуля дейли ещё нет, и строка с вечным прочерком обещала бы данные,
 * которых неоткуда взять. Карточка дейли справа свёрстана по контракту и
 * появится сама, когда сервер начнёт присылать `daily`.
 */
export function Scorecard({
  projectId,
  canWrite,
  onOpenTask,
}: {
  projectId: string;
  canWrite: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const offline = useLiveBlocksEditing();

  const query = useQuery({
    queryKey: scorecardQueryKey(projectId),
    queryFn: () => getScorecard(projectId),
    retry: false,
  });

  // Открытый drill-down: метрика и неделя. Щелчок по строке открывает
  // текущую неделю, щелчок по столбику спарклайна — его неделю.
  const [drill, setDrill] = useState<{ metric: string; week: string } | null>(null);

  // Состав организации — для выбора владельца метрики. Тем же ключом, что и
  // на экране проекта: список один, и второй запрос сюда не ездит.
  const membersQuery = useQuery({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: members,
    retry: false,
    staleTime: Infinity,
  });

  const recalc = useMutation({
    mutationFn: () => recalculateScorecard(projectId),
    onSuccess: (state) => queryClient.setQueryData(scorecardQueryKey(projectId), state),
    onError: (refusal: unknown) => toast({ message: t(errorKey(refusal)), tone: "error" }),
  });

  // Правка владельца и цели — оптимистично: поле меняется под рукой, а не
  // после ответа. Откат — снимком, тем же приёмом, что у useProjectMutation.
  const patch = useMutation({
    mutationFn: (input: { metricKey: string; patch: ScorecardMetricPatch }) =>
      updateScorecardMetric(projectId, input.metricKey, input.patch),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: scorecardQueryKey(projectId) });
      const before = queryClient.getQueryData<ScorecardState>(scorecardQueryKey(projectId));
      if (before) {
        queryClient.setQueryData(
          scorecardQueryKey(projectId),
          applyMetricPatch(before, input.metricKey, input.patch, membersQuery.data ?? []),
        );
      }
      return { before };
    },
    onError: (refusal: unknown, _input, context) => {
      if (context?.before) {
        queryClient.setQueryData(scorecardQueryKey(projectId), context.before);
      }
      toast({ message: t(errorKey(refusal)), tone: "error" });
    },
    // Ответ несёт пересчитанные статусы: цель сменилась — цвет обязан
    // смениться тем же движением.
    onSuccess: (state) => queryClient.setQueryData(scorecardQueryKey(projectId), state),
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

  const state = query.data;
  // daily_health прячется, пока у неё нет источника (см. комментарий выше).
  const visible = state.metrics.filter(
    (metric) => metric.key !== "daily_health" || metric.status !== "no_data",
  );
  const currentWeek = state.week.start;
  const activeAlerts = state.alerts;

  const toggleDrill = (metric: string, week: string) =>
    setDrill((current) =>
      current && current.metric === metric && current.week === week
        ? null
        : { metric, week },
    );

  return (
    <div className="scorecard">
      <div className="scorecard__main">
        <header className="scorecard__head">
          <div>
            <h2 className="scorecard__title">{t("scorecard.title")}</h2>
            <p className="scorecard__subtitle">
              {t("scorecard.subtitle", {
                number: state.week.number,
                start: formatShortDate(t, state.week.start),
                end: formatShortDate(t, state.week.end),
              })}
              {state.computed_at &&
                ` · ${t("scorecard.updated", {
                  time: formatTime(locale, new Date(state.computed_at)),
                })}`}
            </p>
          </div>
          <div className="scorecard__actions">
            {/* Окно истории в MVP одно — селектор статичен, но стоит на месте:
                API уже принимает weeks, и кнопка обещает ровно то, что есть. */}
            <button type="button" className="button--quiet" disabled>
              {t("scorecard.weeks_window")}
            </button>
            {canWrite && (
              <button
                type="button"
                className="scorecard__recalculate"
                disabled={offline || recalc.isPending}
                onClick={() => recalc.mutate()}
              >
                {t("scorecard.recalculate")}
              </button>
            )}
          </div>
        </header>

        <div className="scorecard-table__scroll">
          <table className="scorecard-table">
            <thead>
              <tr>
                <th scope="col">{t("scorecard.columns.metric")}</th>
                <th scope="col">{t("scorecard.columns.value")}</th>
                <th scope="col">{t("scorecard.columns.trend")}</th>
                <th scope="col">{t("scorecard.columns.status")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((metric) => (
                <MetricRow
                  key={metric.key}
                  projectId={projectId}
                  metric={metric}
                  currentWeek={currentWeek}
                  members={membersQuery.data ?? []}
                  canWrite={canWrite && !offline}
                  drillWeek={drill?.metric === metric.key ? drill.week : null}
                  onToggle={(week) => toggleDrill(metric.key, week)}
                  onPatch={(next) => patch.mutate({ metricKey: metric.key, patch: next })}
                  onOpenTask={onOpenTask}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="scorecard-side">
        <section className="scorecard-card">
          <h3 className="scorecard-card__title">
            {t("scorecard.attention.title")}
            {activeAlerts.length > 0 && (
              <span className="scorecard-card__count">{activeAlerts.length}</span>
            )}
          </h3>
          {activeAlerts.length === 0 ? (
            <p className="scorecard-card__empty">{t("scorecard.attention.empty")}</p>
          ) : (
            activeAlerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onOpenTask={onOpenTask}
                onOpenMetric={() => setDrill({ metric: alert.metric_key, week: currentWeek })}
              />
            ))
          )}
        </section>

        {/* Дейли в MVP нет: сервер присылает null, и карточка не рисуется.
            Вёрстка по контракту готова к появлению источника. */}
        {state.daily && <DailyCard daily={state.daily} />}

        {state.data_quality && (
          <section className="scorecard-card">
            <h3 className="scorecard-card__title">{t("scorecard.quality.title")}</h3>
            <p
              className="scorecard-quality__value"
              data-status={qualityStatus(state)}
            >
              {t("scorecard.quality.percent", {
                value: formatAmount(locale, state.data_quality.value),
              })}
            </p>
            <div className="scorecard-quality__bar" role="presentation">
              <div
                className="scorecard-quality__fill"
                data-status={qualityStatus(state)}
                style={{ width: `${Math.max(0, Math.min(100, state.data_quality.value))}%` }}
              />
            </div>
            <p className="scorecard-card__hint">
              {t("scorecard.quality.summary", {
                unreal: state.data_quality.unreal_deadline,
                unassigned: state.data_quality.unassigned,
              })}
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}

/** Статус качества данных — цвет процента и прогресс-бара. */
function qualityStatus(state: ScorecardState): string {
  return state.metrics.find((metric) => metric.key === "data_quality")?.status ?? "no_data";
}

/**
 * Оптимистичное применение правки метрики: то, что человек только что выбрал,
 * встаёт на экран сразу. Статус не пересчитывается — его пришлёт сервер:
 * пороги живут у него, и догадка экрана разошлась бы с ответом.
 */
function applyMetricPatch(
  state: ScorecardState,
  metricKey: string,
  patch: ScorecardMetricPatch,
  roster: { id: string; name: string }[],
): ScorecardState {
  return {
    ...state,
    metrics: state.metrics.map((metric) => {
      if (metric.key !== metricKey) return metric;
      const next = { ...metric };
      if ("target_value" in patch && patch.target_value !== undefined) {
        next.target = patch.target_value;
      }
      if ("enabled" in patch && patch.enabled !== undefined) next.enabled = patch.enabled;
      if ("owner_user_id" in patch) {
        next.owner =
          patch.owner_user_id == null
            ? null
            : {
                id: patch.owner_user_id,
                name: roster.find((member) => member.id === patch.owner_user_id)?.name ?? "",
              };
      }
      return next;
    }),
  };
}

function MetricRow({
  projectId,
  metric,
  currentWeek,
  members: roster,
  canWrite,
  drillWeek,
  onToggle,
  onPatch,
  onOpenTask,
}: {
  projectId: string;
  metric: ScorecardMetric;
  currentWeek: string;
  members: { id: string; name: string }[];
  canWrite: boolean;
  /** Неделя открытого drill-down этой метрики; null — свёрнуто. */
  drillWeek: string | null;
  onToggle: (week: string) => void;
  onPatch: (patch: ScorecardMetricPatch) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { t, locale } = useLocale();
  const name = t(`scorecard.metric.${metric.key}`);
  const sign = metric.direction === "lte" ? "≤" : "≥";
  const value =
    metric.value === null ? "—" : formatMetricValue(locale, metric.key, metric.value);
  const badge = t(`scorecard.status.${metric.status}`);

  return (
    <>
      <tr
        className={`scorecard-row${metric.status === "risk" ? " is-risk" : ""}`}
        aria-expanded={drillWeek !== null}
        onClick={() => onToggle(currentWeek)}
      >
        <td className="scorecard-row__metric">
          <span className="scorecard-row__name">{name}</span>
          {/* Правка владельца — прямо в ячейке; щелчок по ней не должен
              разворачивать строку. */}
          <span
            className="scorecard-row__owner"
            onClick={(event) => event.stopPropagation()}
          >
            {canWrite ? (
              <select
                className="scorecard-row__owner-select"
                aria-label={t("scorecard.owner_label", { metric: name })}
                value={metric.owner?.id ?? ""}
                onChange={(event) =>
                  onPatch({ owner_user_id: event.target.value || null })
                }
              >
                <option value="">{t("scorecard.owner_none")}</option>
                {roster.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            ) : metric.owner ? (
              <>
                <Avatar name={metric.owner.name} size={20} />
                {metric.owner.name}
              </>
            ) : (
              t("scorecard.owner_none")
            )}
          </span>
        </td>
        <td className="scorecard-row__value">
          <strong data-status={metric.status}>{value}</strong>
          <span
            className="scorecard-row__target"
            onClick={(event) => event.stopPropagation()}
          >
            {sign}{" "}
            {canWrite ? (
              <input
                className="scorecard-row__target-input"
                type="number"
                min={0}
                step="0.1"
                aria-label={t("scorecard.target_label", { metric: name })}
                defaultValue={metric.target}
                onBlur={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next >= 0 && next !== metric.target) {
                    onPatch({ target_value: next });
                  }
                }}
              />
            ) : (
              formatMetricValue(locale, metric.key, metric.target)
            )}
          </span>
        </td>
        <td className="scorecard-row__spark">
          <Sparkline metric={metric} onPick={(week) => onToggle(week)} />
        </td>
        <td className="scorecard-row__status">
          <span className="scorecard-badge" data-status={metric.status}>
            {badge}
            {metric.streak >= 2 &&
              metric.status !== "no_data" &&
              ` ${t("scorecard.streak", { count: metric.streak })}`}
          </span>
        </td>
      </tr>
      {drillWeek !== null && (
        <tr className="scorecard-drill">
          <td colSpan={4}>
            <DrillDown
              projectId={projectId}
              metricKey={metric.key}
              week={drillWeek}
              onOpenTask={onOpenTask}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/** Десятичные — через словарь чисел: в ru запятая приходит от Intl. */
function formatMetricValue(locale: string, key: string, value: number): string {
  const amount = formatAmount(locale, value);
  return key === "data_quality" ? `${amount}%` : amount;
}

/**
 * Спарклайн без библиотек: по столбику на неделю, цвет — статус недели,
 * пустая ячейка — no_data. Высота нормируется на максимум окна: спарклайн
 * показывает форму ряда, а не абсолютную шкалу — числа стоят в соседней
 * колонке и в подсказке.
 */
function Sparkline({
  metric,
  onPick,
}: {
  metric: ScorecardMetric;
  onPick: (week: string) => void;
}) {
  const { t, locale } = useLocale();
  const peak = Math.max(...metric.history.map((point) => point.value ?? 0), 1);
  return (
    <span className="scorecard-spark">
      {metric.history.map((point) => {
        const label = `${formatShortDate(t, point.week_start)} · ${
          point.value === null
            ? t("scorecard.status.no_data")
            : formatMetricValue(locale, metric.key, point.value)
        } · ${t(`scorecard.status.${point.status}`)}`;
        return (
          <button
            key={point.week_start}
            type="button"
            className="scorecard-spark__bar"
            data-status={point.status}
            title={label}
            aria-label={label}
            onClick={(event) => {
              event.stopPropagation();
              onPick(point.week_start);
            }}
          >
            {point.value !== null && (
              <span
                className="scorecard-spark__fill"
                data-status={point.status}
                style={{ height: `${Math.max(8, (point.value / peak) * 100)}%` }}
              />
            )}
          </button>
        );
      })}
    </span>
  );
}

/**
 * Список задач метрики за неделю. Прошлые недели сервер читает из снимка,
 * текущую считает вживую — экрану разница не видна, адрес один.
 */
function DrillDown({
  projectId,
  metricKey,
  week,
  onOpenTask,
}: {
  projectId: string;
  metricKey: string;
  week: string;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useLocale();
  const query = useQuery({
    queryKey: scorecardTasksQueryKey(projectId, metricKey, week),
    queryFn: () => scorecardMetricTasks(projectId, metricKey, week),
    retry: false,
  });

  if (query.isPending) return <p role="status">{t("common.loading")}</p>;
  if (query.error) {
    return (
      <p className="error" role="alert">
        {t(errorKey(query.error))}
      </p>
    );
  }

  const details = query.data.details;
  // У качества данных два списка причин; у остальных метрик — один общий.
  const entries: ScorecardTaskEntry[] =
    metricKey === "data_quality"
      ? dedupeById([...(details.unassigned ?? []), ...(details.unreal_deadline ?? [])])
      : (details.tasks ?? []);

  if (entries.length === 0) {
    return <p className="scorecard-drill__empty">{t("scorecard.drill.empty")}</p>;
  }

  return (
    <ul className="scorecard-drill__list">
      {/* Ключ — с номером: у сдвигов дат одна задача встречается по разу на
          операцию, и голый id дал бы двум строкам один ключ. */}
      {entries.map((entry, index) => (
        <li key={`${entry.id}-${index}`}>
          <button
            type="button"
            className="scorecard-drill__task"
            onClick={() => onOpenTask(entry.id)}
          >
            <span className="scorecard-drill__task-name">
              {entry.name ?? t("scorecard.drill.deleted")}
            </span>
            <span className="scorecard-drill__task-meta">
              {entry.assignees && entry.assignees.length > 0 && (
                <span>{entry.assignees.join(", ")}</span>
              )}
              {entryNote(t, entry)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function dedupeById(entries: ScorecardTaskEntry[]): ScorecardTaskEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/** Короткая приписка к задаче — на языке её метрики. */
function entryNote(
  t: (key: string, params?: Record<string, string | number>) => string,
  entry: ScorecardTaskEntry,
): string | null {
  if (entry.days_overdue !== undefined) {
    return t("scorecard.drill.days_overdue", { count: entry.days_overdue });
  }
  if (entry.in_progress_days !== undefined) {
    return t("scorecard.drill.in_progress_days", { count: entry.in_progress_days });
  }
  if (entry.delta_days !== undefined) {
    return t("scorecard.drill.delta_days", { count: entry.delta_days });
  }
  if (entry.closed_in_week !== undefined) {
    return t(
      entry.closed_in_week ? "scorecard.drill.closed" : "scorecard.drill.not_closed",
    );
  }
  if (entry.reasons) {
    return entry.reasons
      .map((reason) => t(`scorecard.drill.reason.${reason}`))
      .join(" · ");
  }
  return null;
}

/** Карточка события: след правила — со ссылкой на задачу, риск — с топом задач. */
function AlertCard({
  alert,
  onOpenTask,
  onOpenMetric,
}: {
  alert: ScorecardAlert;
  onOpenTask: (taskId: string) => void;
  onOpenMetric: () => void;
}) {
  const { t } = useLocale();
  const metricName = t(`scorecard.metric.${alert.metric_key}`);

  if (alert.kind === "rule_triggered") {
    return (
      <article className="scorecard-alert" data-kind="rule">
        <p>{t("scorecard.attention.rule", { metric: metricName })}</p>
        {alert.payload.task_id && (
          <button
            type="button"
            className="scorecard-alert__link"
            onClick={() => onOpenTask(alert.payload.task_id!)}
          >
            {alert.payload.task_name ?? t("scorecard.attention.open_task")}
          </button>
        )}
      </article>
    );
  }

  const top = alert.payload.tasks ?? [];
  return (
    <article className="scorecard-alert" data-kind="risk">
      <p>{t("scorecard.attention.risk", { metric: metricName })}</p>
      {top.length > 0 && (
        <ul className="scorecard-alert__tasks">
          {top.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                className="scorecard-alert__link"
                onClick={() => onOpenTask(task.id)}
              >
                {task.name}
              </button>
              <span className="scorecard-alert__meta">
                {task.assignee ?? t("scorecard.owner_none")} ·{" "}
                {t("scorecard.drill.days_overdue", { count: task.days_overdue })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(alert.payload.total ?? 0) > 0 && (
        <button type="button" className="scorecard-alert__all" onClick={onOpenMetric}>
          {t("scorecard.attention.open_all", { count: alert.payload.total ?? 0 })}
        </button>
      )}
    </article>
  );
}

/**
 * Карточка дейли — контракт вёрстки под будущий модуль. Сегодня сервер шлёт
 * `daily: null`, и карточка не рисуется нигде, кроме тестов с фикстурой.
 */
function DailyCard({
  daily,
}: {
  daily: NonNullable<ScorecardState["daily"]>;
}) {
  const { t, locale } = useLocale();
  const stalled = daily.blockers.some((blocker) => blocker.stalled);
  const peak = Math.max(...daily.by_day.map((day) => day.score ?? 0), 10);
  return (
    <section className="scorecard-card">
      <h3 className="scorecard-card__title">
        {t("scorecard.daily.title")}
        <span className="scorecard-card__count">
          {t("scorecard.daily.held", { held: daily.held, planned: daily.planned })}
        </span>
      </h3>
      <p className="scorecard-daily__score">
        {daily.avg_score === null ? "—" : formatAmount(locale, daily.avg_score)}
      </p>
      <div className="scorecard-daily__bars" role="presentation">
        {daily.by_day.map((day) => (
          <span
            key={day.date}
            className="scorecard-daily__bar"
            style={{ height: `${((day.score ?? 0) / peak) * 100}%` }}
            title={`${formatShortDate(t, day.date)}: ${day.score ?? "—"}`}
          />
        ))}
      </div>
      {daily.blockers.length > 0 && (
        <p className="scorecard-daily__blockers">
          {t("scorecard.daily.blockers", { count: daily.blockers.length })}
          {stalled && (
            <span className="scorecard-daily__stalled">
              {t("scorecard.daily.stalled")}
            </span>
          )}
        </p>
      )}
    </section>
  );
}
