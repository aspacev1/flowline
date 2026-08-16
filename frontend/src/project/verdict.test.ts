import { describe, expect, it } from "vitest";

import type { ProjectState, Task } from "../api/projects";
import {
  deadlineOverrunDays,
  overdueTasks,
  pastDeadlineTasks,
  projectVerdict,
  severityOf,
} from "./verdict";

const TODAY = "2026-03-15";

/** Задача по умолчанию — впереди сегодняшнего дня: просрочку тест объявляет сам. */
function task(fields: Partial<Task> = {}): Task {
  return {
    id: "t1",
    category_id: "c1",
    name: "Логотип",
    start_date: "2026-03-16",
    end_date: "2026-03-20",
    duration_days: 5,
    milestone: false,
    critical: false,
    criticality: "normal",
    status: "in_progress",
    progress_pct: 40,
    position: 0,
    assignee_ids: [],
    baseline_start: null,
    baseline_duration: null,
    baseline_end: null,
    ...fields,
  };
}

function project(fields: Partial<ProjectState> = {}): ProjectState {
  return {
    id: "p1",
    name: "Редизайн",
    slug: "redizayn",
    deadline: null,
    project_end: null,
    schedule_mode: "calendar",
    start_date: "2026-03-02",
    plan_approved_at: null,
    plan_version: 0,
    undoable: null,
    calendar: { working_days: 31, holidays: [], extra_workdays: [] },
    categories: [],
    tasks: [task()],
    dependencies: [],
    ...fields,
  };
}

/** Относительный план: координаты оси от RELATIVE_EPOCH, а не даты. */
function relative(fields: Partial<ProjectState> = {}): ProjectState {
  return project({
    schedule_mode: "relative",
    start_date: null,
    tasks: [task({ start_date: "2001-01-01", end_date: "2001-01-05" })],
    ...fields,
  });
}

describe("просрочка", () => {
  it("считает незакрытую задачу, чей срок прошёл", () => {
    const state = project({ tasks: [task({ end_date: "2026-03-10" })] });

    expect(overdueTasks(state, TODAY)).toHaveLength(1);
  });

  it("не считает завершённую: сделанное поздно уже не требует действия", () => {
    const state = project({ tasks: [task({ end_date: "2026-03-10", status: "done" })] });

    expect(overdueTasks(state, TODAY)).toEqual([]);
  });

  it("не трогает относительный план: там «даты» — координаты 2001 года", () => {
    // Ловушка живая: без проверки режима сравнение с сегодняшним днём
    // помечало бы просроченной каждую строку плана, которому даты ещё не
    // назначали, — и «Отчёты» с «Моими задачами» показывали это годами.
    const state = relative();

    expect(overdueTasks(state, TODAY)).toEqual([]);
    expect(projectVerdict(state, TODAY).kind).not.toBe("overdue");
  });
});

describe("выход за дедлайн проекта", () => {
  it("меряется днями, а не задачами", () => {
    const state = project({ deadline: "2026-06-01", project_end: "2026-06-08" });

    expect(deadlineOverrunDays(state)).toBe(7);
  });

  it("молчит, когда проект укладывается", () => {
    const state = project({ deadline: "2026-06-08", project_end: "2026-06-01" });

    expect(deadlineOverrunDays(state)).toBeNull();
  });

  it("молчит у относительного плана: сравнивать дедлайн не с чем", () => {
    const state = relative({ deadline: "2026-06-01", project_end: "2001-01-05" });

    expect(deadlineOverrunDays(state)).toBeNull();
  });

  it("в счёт задач за дедлайном входят и завершённые — вопрос «в срок ли»", () => {
    const state = project({
      deadline: "2026-03-05",
      tasks: [
        task({ end_date: "2026-03-10", status: "done" }),
        task({ id: "t2", end_date: "2026-03-10" }),
      ],
    });

    // Обе кончаются позже дедлайна, и завершённость одной из них ответа не
    // меняет: это другая величина, чем просрочка выше.
    expect(pastDeadlineTasks(state)).toHaveLength(2);
    expect(overdueTasks(state, TODAY)).toHaveLength(1);
  });
});

describe("вердикт", () => {
  it("у проекта без задач — «плана нет», а не «идёт по плану»", () => {
    expect(projectVerdict(project({ tasks: [] }), TODAY).kind).toBe("empty");
    // И у относительного тоже: назначать старт пустому плану нечему.
    expect(projectVerdict(relative({ tasks: [] }), TODAY).kind).toBe("empty");
  });

  it("просрочка бьёт блокировку: и то и другое верно, срочнее первое", () => {
    const state = project({
      tasks: [task({ end_date: "2026-03-10" }), task({ id: "t2", status: "blocked" })],
    });

    const verdict = projectVerdict(state, TODAY);
    expect(verdict).toMatchObject({ kind: "overdue", tone: "alarm", count: 1 });
  });

  it("блокировка бьёт черновик: даты согласуют когда угодно, работа стоит сейчас", () => {
    const state = project({ tasks: [task({ status: "blocked" })] });

    expect(projectVerdict(state, TODAY)).toMatchObject({ kind: "blocked", tone: "warn", count: 1 });
  });

  it("называет опоздание в днях", () => {
    const state = project({ deadline: "2026-06-01", project_end: "2026-06-08" });

    expect(projectVerdict(state, TODAY)).toMatchObject({ kind: "late", tone: "alarm", days: 7 });
  });

  it("замечает расхождение с согласованным планом", () => {
    const state = project({
      plan_approved_at: "2026-03-01T09:00:00+00:00",
      plan_version: 1,
      tasks: [
        task({
          start_date: "2026-03-18",
          baseline_start: "2026-03-16",
          baseline_duration: 5,
          baseline_end: "2026-03-20",
        }),
      ],
    });

    expect(projectVerdict(state, TODAY)).toMatchObject({ kind: "changed", tone: "warn" });
  });

  it("зовёт назначить дату старта у относительного плана", () => {
    expect(projectVerdict(relative(), TODAY)).toMatchObject({
      kind: "unscheduled",
      tone: "neutral",
    });
  });

  it("зовёт согласовать календарный план, которого не согласовывали", () => {
    expect(projectVerdict(project(), TODAY).kind).toBe("draft");
  });

  it("завершённый проект не зовут ни согласовывать, ни назначать старт", () => {
    const done = project({ tasks: [task({ status: "done", progress_pct: 100 })] });
    const doneRelative = relative({
      tasks: [task({ start_date: "2001-01-01", end_date: "2001-01-05", status: "done", progress_pct: 100 })],
    });

    expect(projectVerdict(done, TODAY).kind).toBe("done");
    expect(projectVerdict(doneRelative, TODAY).kind).toBe("done");
  });

  it("молчит про согласованный план, идущий своим ходом", () => {
    const state = project({
      plan_approved_at: "2026-03-01T09:00:00+00:00",
      plan_version: 1,
      tasks: [
        task({
          baseline_start: "2026-03-16",
          baseline_duration: 5,
          baseline_end: "2026-03-20",
        }),
      ],
    });

    expect(projectVerdict(state, TODAY)).toMatchObject({ kind: "on_track", tone: "calm" });
  });
});

describe("срочность", () => {
  it("ставит требующее действия выше спокойного", () => {
    const order = (state: ProjectState) => severityOf(projectVerdict(state, TODAY));

    const overdue = order(project({ tasks: [task({ end_date: "2026-03-10" })] }));
    const blocked = order(project({ tasks: [task({ status: "blocked" })] }));
    const draft = order(project());
    const empty = order(project({ tasks: [] }));
    const done = order(project({ tasks: [task({ status: "done", progress_pct: 100 })] }));

    expect(overdue).toBeGreaterThan(blocked);
    expect(blocked).toBeGreaterThan(draft);
    expect(draft).toBeGreaterThan(empty);
    expect(empty).toBeGreaterThan(done);
  });

  it("проект без пришедшей сводки не выдаёт себя за спокойный и за тревожный", () => {
    const done = severityOf(projectVerdict(project({ tasks: [task({ status: "done", progress_pct: 100 })] }), TODAY));
    const blocked = severityOf(projectVerdict(project({ tasks: [task({ status: "blocked" })] }), TODAY));

    expect(severityOf(null)).toBeGreaterThan(done);
    expect(severityOf(null)).toBeLessThan(blocked);
  });
});
