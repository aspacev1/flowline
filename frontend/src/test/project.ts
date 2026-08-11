import { HttpResponse, http } from "msw";

import type { ProjectState } from "../api/projects";
import type { Locale } from "../i18n";
import { reorderTask } from "../project/optimistic";
import { server } from "./server";
import { ORG, USER, renderApp } from "./utils";

/**
 * Оснастка экрана проекта: одно состояние, одни ответы сервера, один способ
 * его нарисовать.
 *
 * Карточку задачи, перетаскивание и перестановку строк проверяют четыре разных
 * файла, и каждому нужен один и тот же проект с теми же датами. Скопированное
 * в четыре места состояние расходится на второй правке, и тесты начинают
 * проверять четыре разных проекта под одними названиями.
 */

export const MEMBERS = [
  { id: "u1", name: "Алексей", email: "a@b.c", role: "owner" },
  { id: "u2", name: "Мария", email: "m@b.c", role: "editor" },
];

export const STATE: ProjectState = {
  id: "p1",
  name: "Редизайн",
  slug: "redizayn",
  deadline: "2026-06-01",
  project_end: "2026-06-08",
  plan_approved_at: null,
  plan_version: 0,
  calendar: { working_days: 31, holidays: ["2026-03-20"], extra_workdays: [] },
  settings: { shift_threshold_days: 2, timezone: "Asia/Baku" },
  categories: [
    { id: "c1", name: "Дизайн", color: "#3b82f6", position: 0 },
    { id: "c2", name: "Разработка", color: "#a855f7", position: 1 },
  ],
  tasks: [
    {
      id: "t1",
      category_id: "c1",
      name: "Логотип",
      description: "Знак",
      start_date: "2026-03-04",
      end_date: "2026-03-10",
      duration_days: 5,
      criticality: "high",
      progress_pct: 40,
      position: 0,
      assignee_ids: [],
      baseline_start: null,
      baseline_duration: null,
      baseline_end: null,
      internal_note: "",
    },
  ],
  dependencies: [],
};

/** Тот же проект: обе категории на месте и в базовом состоянии. */
export const TWO_CATEGORIES = STATE;

/** Три задачи в одной категории — для перестановки строк. */
export const THREE_TASKS: ProjectState = {
  ...STATE,
  tasks: [
    { ...STATE.tasks[0], id: "t1", name: "Первая", position: 0 },
    {
      ...STATE.tasks[0],
      id: "t2",
      name: "Вторая",
      position: 1,
      start_date: "2026-03-11",
      end_date: "2026-03-17",
    },
    {
      ...STATE.tasks[0],
      id: "t3",
      name: "Третья",
      position: 2,
      start_date: "2026-03-18",
      end_date: "2026-03-24",
    },
  ],
};

/**
 * Тот же проект с утверждённым планом.
 *
 * Базовый план совпадает с текущими датами: задача ещё никуда не уехала, и
 * любое отклонение в тесте — целиком заслуга самого теста, а не оснастки.
 */
export const APPROVED: ProjectState = {
  ...STATE,
  plan_approved_at: "2026-03-01T09:00:00+00:00",
  plan_version: 1,
  tasks: [
    {
      ...STATE.tasks[0],
      baseline_start: "2026-03-04",
      baseline_duration: 5,
      baseline_end: "2026-03-10",
    },
  ],
};

/** Утверждённый план и задача, добавленная после утверждения. */
export const APPROVED_WITH_EXTRA: ProjectState = {
  ...APPROVED,
  tasks: [
    ...APPROVED.tasks,
    {
      ...STATE.tasks[0],
      id: "t2",
      name: "Сверх плана",
      position: 1,
      start_date: "2026-03-11",
      end_date: "2026-03-17",
      baseline_start: null,
      baseline_duration: null,
      baseline_end: null,
    },
  ],
};

/** Две задачи со стрелкой между ними. */
export const WITH_DEPENDENCY: ProjectState = {
  ...STATE,
  tasks: [
    STATE.tasks[0],
    {
      ...STATE.tasks[0],
      id: "t2",
      name: "Макет",
      position: 1,
      start_date: "2026-03-11",
      end_date: "2026-03-17",
    },
  ],
  dependencies: [{ from_task_id: "t1", to_task_id: "t2" }],
};

export type Sent = { op: Record<string, unknown>; reason?: string };

/**
 * Принятая операция, отражённая в состоянии.
 *
 * Без этого сервер-заглушка отвечал бы «принято» и продолжал отдавать прежний
 * проект: перезапрос после успеха возвращал бы изменение назад, и тест на
 * второй щелчок по исполнителю проверял бы не то, что написано в его названии.
 *
 * Дата окончания здесь не пересчитывается намеренно — календаря у заглушки
 * нет. Это и хорошо: тест, ожидающий пересчитанный конец, обязан объявить его
 * сам, а не получить его от подделки под сервер.
 */
function applied(state: ProjectState, op: Record<string, unknown>): ProjectState {
  const id = op.task_id as string;
  const patch = (fields: Partial<ProjectState["tasks"][number]>) => ({
    ...state,
    tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...fields } : task)),
  });
  const assignees = state.tasks.find((task) => task.id === id)?.assignee_ids ?? [];

  switch (op.type) {
    case "move_task":
      return patch({ start_date: op.start_date as string });
    case "set_duration":
      return patch({ duration_days: op.duration_days as number });
    case "set_progress":
      return patch({ progress_pct: op.progress_pct as number });
    case "set_criticality":
      return patch({ criticality: op.criticality as ProjectState["tasks"][number]["criticality"] });
    case "set_task_fields":
      return patch({
        name: op.name as string,
        description: op.description as string,
        internal_note: op.internal_note as string,
      });
    case "assign_user":
      return patch({ assignee_ids: [...assignees, op.user_id as string] });
    case "unassign_user":
      return patch({ assignee_ids: assignees.filter((user) => user !== op.user_id) });
    case "reorder_task":
      return reorderTask(state, id, op.category_id as string, op.position as number);
    default:
      return state;
  }
}

// Состояние оснастки. Живёт в модуле, а не в замыкании renderProject, потому
// что обработчики регистрируются раньше — в beforeEach, — и обязаны видеть то,
// что тест выберет позже.
let state: ProjectState = STATE;
let role = "owner";
const sent: Sent[] = [];

/**
 * Ответы сервера по умолчанию. Ставятся в `beforeEach`, а не внутри
 * `renderProject`, и это важно: msw отдаёт предпочтение обработчику,
 * зарегистрированному последним. Тест, объявляющий отказ через `server.use` в
 * своём теле, обязан перебить оснастку — а перебивает он только то, что
 * зарегистрировано до него.
 */
export function projectFixtures() {
  state = STATE;
  role = "owner";
  sent.length = 0;

  server.use(
    http.get("/api/auth/me", () => HttpResponse.json(USER)),
    http.get("/api/org", () => HttpResponse.json({ ...ORG, role })),
    http.get("/api/org/members", () => HttpResponse.json(MEMBERS)),
    http.get("/api/projects/p1", () => HttpResponse.json(state)),
    // Журнал карточки. Пустой по умолчанию: тест, которому история важна,
    // объявляет её сам.
    http.get("/api/projects/p1/revisions", () => HttpResponse.json([])),
    http.post("/api/projects/p1/mutations", async ({ request }) => {
      const body = (await request.json()) as Sent;
      sent.push(body);
      state = applied(state, body.op);
      return HttpResponse.json({ seq: sent.length, op: body.op, inverse: {} }, { status: 201 });
    }),
  );
}

/**
 * Операции, ушедшие на сервер с начала теста.
 *
 * Массив живой: он наполняется по ходу, и его не нужно перезапрашивать. Один и
 * тот же массив на весь тест — поэтому вызвать это можно и до отрисовки, как
 * оно и читается в тестах.
 */
export function captureMutations(): Sent[] {
  return sent;
}

export function renderProject(
  next: ProjectState = STATE,
  options: { canWrite?: boolean; locale?: Locale } = {},
) {
  const { canWrite = true, locale = "ru" } = options;
  state = next;
  // Гость по спеку — это роль без права писать, а не человек без сессии:
  // диаграмму он видит, трогать её не может.
  role = canWrite ? "owner" : "viewer";
  return renderApp({ route: "/projects/p1", locale });
}
