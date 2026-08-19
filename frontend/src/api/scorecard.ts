import { request } from "./client";

/**
 * Скоркард проекта: недельная панель здоровья плана.
 *
 * GET — с побочным эффектом: планировщика на сервере нет, и первый читатель
 * после границы недели дозаписывает недельные снимки (ленивая фиксация).
 * Значения приходят посчитанными: клиент их не пересказывает, он только
 * рисует — формулы метрик живут в одном месте, на сервере (app/scorecard.py).
 */

export type ScorecardStatus = "ok" | "warn" | "risk" | "no_data";
export type ScorecardDirection = "lte" | "gte";
export type ScorecardMetricKey =
  | "overdue_tasks"
  | "avg_overdue_days"
  | "date_shifts"
  | "close_rate"
  | "stale_in_progress"
  | "unassigned_tasks"
  | "daily_health"
  | "data_quality";

export type ScorecardHistoryPoint = {
  week_start: string;
  value: number | null;
  status: ScorecardStatus;
};

export type ScorecardMetric = {
  key: ScorecardMetricKey;
  direction: ScorecardDirection;
  target: number;
  enabled: boolean;
  owner: { id: string; name: string } | null;
  value: number | null;
  status: ScorecardStatus;
  /** Недель подряд (включая текущую) в текущем статусе. */
  streak: number;
  /** Снимки окна истории, от старых к новым; текущая неделя — последней. */
  history: ScorecardHistoryPoint[];
};

export type ScorecardAlert = {
  id: string;
  metric_key: ScorecardMetricKey;
  kind: "rule_triggered" | "metric_risk";
  week_start: string;
  created_at: string;
  payload: {
    value?: number | null;
    total?: number;
    tasks?: { id: string; name: string; assignee: string | null; days_overdue: number }[];
    task_id?: string;
    task_name?: string;
  };
};

/**
 * Контракт под будущий модуль дейли. Сервер сегодня отдаёт `daily: null` —
 * тип описан, чтобы правая колонка была свёрстана заранее (см. Scorecard).
 */
export type ScorecardDaily = {
  held: number;
  planned: number;
  avg_score: number | null;
  by_day: { date: string; score: number | null }[];
  blockers: { task_id: string | null; text: string; stalled: boolean }[];
};

export type ScorecardState = {
  week: { number: number; start: string; end: string };
  computed_at: string | null;
  metrics: ScorecardMetric[];
  alerts: ScorecardAlert[];
  daily: ScorecardDaily | null;
  data_quality: {
    value: number;
    total: number;
    unassigned: number;
    unreal_deadline: number;
  } | null;
};

/** Запись drill-down: задача с атрибутами своей метрики. */
export type ScorecardTaskEntry = {
  id: string;
  name: string | null;
  status?: string;
  end_date?: string | null;
  assignees?: string[];
  days_overdue?: number;
  in_progress_days?: number;
  delta_days?: number;
  closed_in_week?: boolean;
  reasons?: string[];
};

export type ScorecardMetricTasks = {
  metric_key: ScorecardMetricKey;
  week_start: string;
  value: number | null;
  details: {
    tasks?: ScorecardTaskEntry[];
    unassigned?: ScorecardTaskEntry[];
    unreal_deadline?: ScorecardTaskEntry[];
    [key: string]: unknown;
  };
};

export type ScorecardMetricPatch = Partial<{
  owner_user_id: string | null;
  target_value: number;
  enabled: boolean;
}>;

/**
 * Ключ — внутри ключа проекта: ревизия из сокета сбрасывает проект целиком,
 * и скоркард, чьё правило само рождает ревизии, обновляется тем же вызовом.
 */
export function scorecardQueryKey(projectId: string) {
  return ["project", projectId, "scorecard"] as const;
}

/** Drill-down недели — внутри ключа скоркарда: сброс задевает и его. */
export function scorecardTasksQueryKey(projectId: string, metricKey: string, week: string) {
  return ["project", projectId, "scorecard", "tasks", metricKey, week] as const;
}

export function getScorecard(projectId: string): Promise<ScorecardState> {
  return request<ScorecardState>(`/api/projects/${projectId}/scorecard?weeks=13`);
}

/** Пересчёт текущей недели мимо кэша; сервер держит предел — раз в минуту. */
export function recalculateScorecard(projectId: string): Promise<ScorecardState> {
  return request<ScorecardState>(`/api/projects/${projectId}/scorecard/recalculate?weeks=13`, {
    method: "POST",
  });
}

export function updateScorecardMetric(
  projectId: string,
  metricKey: string,
  patch: ScorecardMetricPatch,
): Promise<ScorecardState> {
  return request<ScorecardState>(
    `/api/projects/${projectId}/scorecard/metrics/${metricKey}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

export function scorecardMetricTasks(
  projectId: string,
  metricKey: string,
  week: string,
): Promise<ScorecardMetricTasks> {
  return request<ScorecardMetricTasks>(
    `/api/projects/${projectId}/scorecard/metrics/${metricKey}/tasks?week=${week}`,
  );
}
