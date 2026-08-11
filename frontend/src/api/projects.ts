import { request } from "./client";

export const PROJECTS_QUERY_KEY = ["projects"] as const;

/** Ключ состояния одного проекта. Отдельный от списка: они живут своей жизнью. */
export function projectQueryKey(id: string) {
  return ["project", id] as const;
}

export type Project = {
  id: string;
  name: string;
  slug: string;
};

/**
 * Рабочий календарь проекта в том виде, в каком его прислал сервер.
 *
 * `working_days` — битовая маска, где бит 0 это понедельник: так её считает
 * Python, и переводить её в другую нумерацию по дороге значило бы завести
 * второе представление одного и того же.
 */
export type Calendar = {
  working_days: number;
  holidays: string[];
  extra_workdays: string[];
};

export const CRITICALITY_LEVELS = ["low", "normal", "high", "critical"] as const;
export type Criticality = (typeof CRITICALITY_LEVELS)[number];

export type Category = {
  id: string;
  name: string;
  color: string;
  position: number;
};

export type Task = {
  id: string;
  category_id: string;
  name: string;
  description?: string;
  start_date: string;
  duration_days: number;
  /** Считает сервер. Клиент календарную арифметику не повторяет. */
  end_date: string;
  criticality: Criticality;
  progress_pct: number;
  position: number;
  assignee_ids: string[];
  /**
   * Базовый план: даты на момент утверждения. `null` у всех задач, пока план
   * не утверждён, и у тех, что созданы после утверждения, — вторые и есть
   * «сверх первоначального плана». Отдельного флага нет намеренно: он был бы
   * вычислим из этих же полей и однажды разошёлся бы с ними.
   */
  baseline_start: string | null;
  baseline_duration: number | null;
  /** Считает сервер по календарю проекта — как и обычную дату окончания. */
  baseline_end: string | null;
  /** Приходит только тем, у кого есть право её читать. */
  internal_note?: string;
};

export type Dependency = {
  from_task_id: string;
  to_task_id: string;
};

export type ProjectState = {
  id: string;
  name: string;
  slug: string;
  deadline: string | null;
  project_end: string | null;
  /** `null` — план ещё черновик: правки свободны, ничего не спрашивается. */
  plan_approved_at: string | null;
  plan_version: number;
  calendar: Calendar;
  settings?: { shift_threshold_days: number; timezone: string };
  categories: Category[];
  tasks: Task[];
  dependencies: Dependency[];
};

/**
 * Операции в том виде, в каком их принимает провод.
 *
 * Полей восстановления здесь нет и быть не может: `category_id` при создании
 * категории, `task_id` при создании задачи и `position` назначает сервер.
 * Сервер отбивает лишние поля (`extra="forbid"`), но полагаться на это как на
 * единственную защиту нельзя — тип обязан описывать контракт честно, иначе
 * такое поле однажды допишут и узнают об этом только в бою.
 */
export type Op =
  | { type: "create_category"; name: string; color: string }
  | {
      type: "create_task";
      category_id: string;
      name: string;
      start_date: string;
      duration_days: number;
      description?: string;
      internal_note?: string;
      criticality?: Criticality;
      progress_pct?: number;
    }
  | { type: "move_task"; task_id: string; start_date: string }
  | { type: "set_duration"; task_id: string; duration_days: number }
  | {
      type: "set_task_fields";
      task_id: string;
      name: string;
      description: string;
      internal_note: string;
    }
  | { type: "set_criticality"; task_id: string; criticality: Criticality }
  | { type: "set_progress"; task_id: string; progress_pct: number }
  | { type: "reorder_task"; task_id: string; category_id: string; position: number }
  | { type: "assign_user"; task_id: string; user_id: string }
  | { type: "unassign_user"; task_id: string; user_id: string };

/** Ответ на применённую операцию. Номер ревизии — то, чем она отличается от соседних. */
export type Revision = {
  seq: number;
  op: Record<string, unknown>;
  inverse: Record<string, unknown>;
};

export function listProjects(): Promise<Project[]> {
  return request<Project[]>("/api/projects");
}

export function createProject(name: string): Promise<Project> {
  return request<Project>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getProject(id: string): Promise<ProjectState> {
  return request<ProjectState>(`/api/projects/${id}`);
}

/**
 * Единственный способ изменить что-либо в проекте.
 *
 * Причина не подставляется пустой строкой, когда её нет: сервер отличает
 * «причины не требовалось» от «причина пустая», и первое — это отсутствие
 * ключа, а не ключ со значением.
 */
export function applyOp(projectId: string, op: Op, reason?: string): Promise<Revision> {
  return request<Revision>(`/api/projects/${projectId}/mutations`, {
    method: "POST",
    body: JSON.stringify(reason === undefined ? { op } : { op, reason }),
  });
}

/** Одна утверждённая версия плана. Снимок — даты и длительности по задачам. */
export type PlanApproval = {
  version: number;
  approved_at: string;
  approved_by: { id: string; name: string } | null;
  snapshot: Record<string, { name: string; start_date: string; duration_days: number }>;
};

/**
 * Утвердить план — или переутвердить, если он уже утверждён.
 *
 * Маршрут один: действие одно и то же, различие лишь в том, кому оно
 * позволено, и решает это сервер.
 */
export function approvePlan(projectId: string): Promise<{ version: number; approved_at: string }> {
  return request(`/api/projects/${projectId}/plan/approvals`, { method: "POST" });
}

export function listPlanApprovals(projectId: string): Promise<PlanApproval[]> {
  return request<PlanApproval[]>(`/api/projects/${projectId}/plan/approvals`);
}
