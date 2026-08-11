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
  | { type: "assign_user"; task_id: string; user_id: string };

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
