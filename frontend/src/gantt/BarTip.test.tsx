import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ProjectState, Task } from "../api/projects";
import { renderWithProviders } from "../test/utils";
import { Gantt } from "./Gantt";

const TASK: Task = {
  id: "t1",
  category_id: "c1",
  name: "Логотип",
  start_date: "2026-03-04",
  end_date: "2026-03-10",
  duration_days: 5,
  criticality: "high",
  status: "in_progress",
  progress_pct: 40,
  position: 0,
  assignee_ids: [],
  baseline_start: null,
  baseline_duration: null,
  baseline_end: null,
};

const STATE: ProjectState = {
  id: "p1",
  name: "Редизайн",
  slug: "redizayn",
  deadline: null,
  project_end: null,
  plan_approved_at: null,
  plan_version: 0,
  undoable: null,
  calendar: { working_days: 31, holidays: [], extra_workdays: [] },
  categories: [{ id: "c1", name: "Дизайн", color: "#3b82f6", position: 0 }],
  tasks: [TASK],
  dependencies: [],
};

const NAMES = new Map([
  ["u1", "Алексей"],
  ["u2", "Мария"],
  ["u3", "Нигяр"],
]);

/**
 * Лента с карточкой наведения.
 *
 * `onSelectTask` передаётся всегда: с ним полоска — кнопка, а без него
 * картинка, и половина проверок ниже (фокус с клавиатуры) на картинке
 * невозможна в принципе.
 */
function draw(
  options: {
    state?: ProjectState;
    names?: ReadonlyMap<string, string>;
    /** Право двигать полоску: от него зависит строка сочетаний в карточке. */
    canWrite?: boolean;
  } = {},
) {
  return renderWithProviders(
    <Gantt
      projectId="p1"
      state={options.state ?? STATE}
      assigneeNames={options.names}
      canWrite={options.canWrite}
      onSelectTask={() => {}}
    />,
    { locale: "ru" },
  );
}

function bar() {
  return screen.getByRole("button", { name: /Логотип/ });
}

/** Проект с теми же задачами, но с назначенными исполнителями. */
function withAssignees(...ids: string[]): ProjectState {
  return { ...STATE, tasks: [{ ...TASK, assignee_ids: ids }] };
}

describe("карточка наведения на полоску", () => {
  it("называет статус, даты и готовность", async () => {
    draw();

    await userEvent.hover(bar());

    const tip = screen.getByTestId("bar-tip");
    expect(tip).toHaveTextContent("Логотип");
    expect(tip).toHaveTextContent("В работе");
    expect(tip).toHaveTextContent("4 мар → 10 мар");
    expect(tip).toHaveTextContent("40%");
  });

  it("исчезает, когда курсор ушёл с полоски", async () => {
    draw();

    await userEvent.hover(bar());
    expect(screen.getByTestId("bar-tip")).toBeInTheDocument();

    await userEvent.unhover(bar());
    expect(screen.queryByTestId("bar-tip")).not.toBeInTheDocument();
  });

  it("предупреждает знаком о заблокированной задаче", async () => {
    draw({ state: { ...STATE, tasks: [{ ...TASK, status: "blocked" }] } });

    await userEvent.hover(bar());

    expect(screen.getByTestId("bar-tip")).toHaveTextContent("⚠ Заблокировано");
  });

  it("одного исполнителя зовёт по имени", async () => {
    draw({ state: withAssignees("u1"), names: NAMES });

    await userEvent.hover(bar());

    expect(screen.getByTestId("bar-tip")).toHaveTextContent("Алексей");
  });

  it("нескольких сводит к первому и счётчику остальных", async () => {
    draw({ state: withAssignees("u1", "u2", "u3"), names: NAMES });

    await userEvent.hover(bar());

    // Перечисления карточка такой ширины не выдержит, а «+2» отвечает на
    // вопрос «одна ли это работа» не хуже трёх имён.
    const tip = screen.getByTestId("bar-tip");
    expect(tip).toHaveTextContent("Алексей +2");
    expect(tip).not.toHaveTextContent("Мария");
  });

  it("без имён обходится без строки исполнителей, но процент оставляет", async () => {
    // Ровно то, что происходит на публичной странице: состав организации
    // гостю не отдают, и назначенные исполнители остаются безымянными.
    draw({ state: withAssignees("u1", "u2") });

    await userEvent.hover(bar());

    const tip = screen.getByTestId("bar-tip");
    expect(tip).not.toHaveTextContent("Алексей");
    expect(tip).toHaveTextContent("40%");
  });

  it("не пишет имён, которых нет в составе", async () => {
    // Ушедший из организации остаётся в `assignee_ids`, но имени у него уже
    // нет: карточка молчит о нём, а не пишет «undefined».
    draw({ state: withAssignees("u9"), names: NAMES });

    await userEvent.hover(bar());

    expect(screen.getByTestId("bar-tip")).not.toHaveTextContent("undefined");
  });

  it("гаснет на время жеста и не возвращается под палец сама", async () => {
    draw();

    await userEvent.hover(bar());
    expect(screen.getByTestId("bar-tip")).toBeInTheDocument();

    // Карточка, идущая за курсором, закрывала бы ровно ту сетку дней, по
    // которой человек целится.
    fireEvent.pointerDown(bar(), { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    expect(screen.queryByTestId("bar-tip")).not.toBeInTheDocument();

    fireEvent.pointerMove(bar(), { pointerId: 1, clientX: 160, clientY: 100 });
    expect(screen.queryByTestId("bar-tip")).not.toBeInTheDocument();

    // И после отпускания тоже: указатель всё ещё стоит на полоске, а наведения
    // заново не было.
    fireEvent.pointerUp(bar(), { pointerId: 1, clientX: 160, clientY: 100 });
    expect(screen.queryByTestId("bar-tip")).not.toBeInTheDocument();

    await userEvent.unhover(bar());
    await userEvent.hover(bar());
    expect(screen.getByTestId("bar-tip")).toBeInTheDocument();
  });

  it("показывается по фокусу с клавиатуры и прячется, когда фокус ушёл", () => {
    draw();

    fireEvent.focus(bar());
    expect(screen.getByTestId("bar-tip")).toBeInTheDocument();

    fireEvent.blur(bar());
    expect(screen.queryByTestId("bar-tip")).not.toBeInTheDocument();
  });

  it("называет сочетания клавиш тому, кто может двигать полоску", async () => {
    // Карточка наведения — единственное место, где человек читает про задачу,
    // ничего не открыв: подсказка про клавиши живёт здесь, а не в справке,
    // которую никто не ищет.
    draw({ canWrite: true });

    await userEvent.hover(bar());

    const tip = screen.getByTestId("bar-tip");
    expect(tip).toHaveTextContent("Shift + ←→");
    expect(tip).toHaveTextContent("Esc");
    // Модификатор зовётся так, как он зовётся в этой системе: «Ctrl» на Маке
    // назвал бы клавишу, которая там ничего не отменяет.
    expect(tip).toHaveTextContent(/(Ctrl|⌘)\+Z/);
  });

  it("читателю сочетаний не обещает", async () => {
    draw();

    await userEvent.hover(bar());

    // Двигать полоску читатель не может, и клавиши обещали бы ему работу,
    // которую сервер отклонит.
    expect(screen.getByTestId("bar-tip")).not.toHaveTextContent("Shift");
  });

  it("скрыта от чтения с экрана: полоска называет то же самое сама", async () => {
    draw();

    await userEvent.hover(bar());

    expect(screen.getByTestId("bar-tip")).toHaveAttribute("aria-hidden", "true");
    // Нативной подсказки у полоски нет: браузерная всплывала бы поверх этой
    // карточки и говорила бы то же самое вторым окном.
    expect(bar()).not.toHaveAttribute("title");
    expect(bar()).toHaveAccessibleName("Логотип, 4 марта — 10 марта");
  });
});
