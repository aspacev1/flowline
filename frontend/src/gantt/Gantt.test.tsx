import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectState } from "../api/projects";
import type { Locale } from "../i18n";
import { renderWithProviders } from "../test/utils";
import { Gantt } from "./Gantt";
import { DAY_WIDTH } from "./scale";

const STATE: ProjectState = {
  id: "p1",
  name: "Редизайн",
  slug: "redizayn",
  deadline: "2026-06-01",
  project_end: "2026-06-08",
  plan_approved_at: null,
  plan_version: 0,
  undoable: null,
  calendar: { working_days: 31, holidays: ["2026-03-20"], extra_workdays: [] },
  categories: [{ id: "c1", name: "Дизайн", color: "#3b82f6", position: 0 }],
  tasks: [
    {
      id: "t1",
      category_id: "c1",
      name: "Логотип",
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
    },
  ],
  dependencies: [],
};

/**
 * Диаграмма читает язык из провайдера: итог по дедлайну — это фраза, а не
 * картинка. Поэтому рисуем её всегда внутри провайдеров, как в приложении.
 *
 * Без `canWrite` и без `onSelectTask` — то есть на чтение, как на публичной
 * странице. В этом виде полоска объявляется картинкой, а не кнопкой (см. Bar
 * в Row.tsx), и тесты ниже спрашивают её по роли `img`. Проверяют они рисунок
 * — ширину, класс, порядок, — а не поведение органа управления.
 */
function draw(state: ProjectState, locale: Locale = "ru") {
  return renderWithProviders(<Gantt projectId="p1" state={state} />, { locale });
}

function drawWithToolbar(locale: Locale = "ru") {
  return renderWithProviders(
    <Gantt projectId="p1" state={STATE} toolbarAction={<button type="button">New task</button>} />,
    { locale },
  );
}

describe("диаграмма", () => {
  // Единственный тест с приколоченным «сегодня» возвращает часы на место,
  // чтобы соседям досталось настоящее время.
  afterEach(() => vi.restoreAllMocks());

  it("рисует задачу полоской нужной ширины", () => {
    draw(STATE);
    const bar = screen.getByRole("img", { name: /Логотип/ });
    // 4-10 марта — семь календарных дней
    expect(bar).toHaveStyle({ width: `${7 * DAY_WIDTH}px` });
  });

  it("ставит полоску в её день, а не в начало ленты", () => {
    const { container } = draw(STATE);
    // Окно открывается с первого числа месяца самой ранней задачи: 4 марта
    // отстоит от 1 марта на три дня.
    expect(container.querySelector<HTMLElement>(".gantt__bar")).toHaveStyle({
      left: `${3 * DAY_WIDTH}px`,
    });
  });

  it("заливает выходные и праздники", () => {
    const { container } = draw(STATE);
    expect(container.querySelectorAll(".is-nonworking").length).toBeGreaterThan(0);
    expect(container.querySelector('[data-day="2026-03-20"]')).toHaveClass("is-nonworking");
  });

  it("рабочий день не залит", () => {
    const { container } = draw(STATE);
    // 19 марта 2026 — четверг и не праздник.
    expect(container.querySelector('[data-day="2026-03-19"]')).not.toHaveClass("is-nonworking");
  });

  it("рабочая суббота из календаря перебивает выходной", () => {
    const { container } = draw({
      ...STATE,
      calendar: { ...STATE.calendar, extra_workdays: ["2026-03-21"] },
    });
    expect(container.querySelector('[data-day="2026-03-21"]')).not.toHaveClass("is-nonworking");
  });

  it("красит задачу, заезжающую за дедлайн", () => {
    draw({ ...STATE, tasks: [{ ...STATE.tasks[0], end_date: "2026-06-05" }] });
    expect(screen.getByRole("img", { name: /Логотип/ })).toHaveClass("is-late");
  });

  it("задача, кончающаяся ровно в день дедлайна, не просрочена", () => {
    draw({ ...STATE, tasks: [{ ...STATE.tasks[0], end_date: "2026-06-01" }] });
    expect(screen.getByRole("img", { name: /Логотип/ })).not.toHaveClass("is-late");
  });

  it("показывает итог по дедлайну на языке читателя", () => {
    draw(STATE, "ru");
    expect(screen.getByText(/на 7 дней позже/i)).toBeInTheDocument();
  });

  it("укладывающийся в дедлайн проект получает свой итог, а не тот же самый", () => {
    draw({ ...STATE, project_end: "2026-05-27" }, "ru");
    expect(screen.getByText(/запас 5 дней/i)).toBeInTheDocument();
  });

  it("сортирует строки по позиции, а при равенстве — по идентификатору", () => {
    draw({
      ...STATE,
      tasks: [
        { ...STATE.tasks[0], id: "t2", name: "Вторая", position: 1 },
        { ...STATE.tasks[0], id: "t1", name: "Первая", position: 1 },
      ],
    });
    const names = screen
      .getAllByRole("img", { name: /Первая|Вторая/ })
      .map((node) => node.textContent);
    expect(names).toEqual(["Первая", "Вторая"]);
  });

  it("пустой проект объясняет, что делать", () => {
    draw({ ...STATE, categories: [], tasks: [] }, "ru");
    expect(screen.getByText(/ни одной категории/i)).toBeInTheDocument();
  });

  it("категория без задач всё равно видна", () => {
    // Иначе только что созданная категория исчезает, и человек решает, что
    // создание не сработало.
    draw({ ...STATE, tasks: [] }, "ru");
    expect(screen.getByText("Дизайн")).toBeInTheDocument();
    expect(screen.queryByText(/ни одной категории/i)).not.toBeInTheDocument();
  });

  it("сетка строится один раз, а не по набору дней на каждую строку", () => {
    const many = draw({
      ...STATE,
      tasks: [
        { ...STATE.tasks[0], id: "t1", name: "Раз", position: 0 },
        { ...STATE.tasks[0], id: "t2", name: "Два", position: 1 },
        { ...STATE.tasks[0], id: "t3", name: "Три", position: 2 },
      ],
    });
    const one = draw(STATE);
    // Клеток дня столько же, сколько при одной задаче: сетка общая. Сотня
    // задач на сотне дней иначе дала бы десять тысяч узлов.
    expect(many.container.querySelectorAll(".gantt__grid-day").length).toBe(
      one.container.querySelectorAll(".gantt__grid-day").length,
    );
  });

  it("прогресс задачи виден в полоске", () => {
    const { container } = draw(STATE);
    expect(container.querySelector<HTMLElement>(".gantt__progress")).toHaveStyle({
      width: "40%",
    });
  });

  it("показывает легенду: статусы, блокер и обе вертикали", () => {
    draw(STATE, "ru");
    expect(screen.getAllByText("В работе").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Готово").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Запланировано").length).toBeGreaterThan(0);
    expect(screen.getByText("Блокер")).toBeInTheDocument();
    expect(screen.getByText("Сегодня")).toBeInTheDocument();
  });

  it("в пустом проекте легенды нет: расшифровывать нечего", () => {
    draw({ ...STATE, categories: [], tasks: [] }, "ru");
    expect(screen.queryByText("В работе")).not.toBeInTheDocument();
  });

  it("статус полоски считается из прогресса и дат", () => {
    // Начатая в прошлом и не готовая — «в работе»; стопроцентная — «готово»;
    // со стартом в будущем — «запланировано».
    //
    // «Сегодня» приколочено, а не берётся из часов: статус сравнивает даты с
    // текущим днём, и «будущая» задача с настоящих часов требовала бы даты,
    // которая в будущем всегда. Такой и была — 2100 год, — но окно ленты
    // накрывает все даты задач, и тест молча рисовал 74 года сетки:
    // ~8 секунд на быстрой машине и таймаут на нагруженном раннере CI.
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-03-06T12:00:00Z").getTime());
    draw({
      ...STATE,
      tasks: [
        { ...STATE.tasks[0], id: "t1", name: "Идёт", position: 0 },
        { ...STATE.tasks[0], id: "t2", name: "Сделана", position: 1, progress_pct: 100 },
        {
          ...STATE.tasks[0],
          id: "t3",
          name: "Будет",
          position: 2,
          start_date: "2026-03-23",
          end_date: "2026-03-27",
        },
      ],
    });
    expect(screen.getByRole("img", { name: /Идёт/ })).toHaveAttribute("data-status", "active");
    expect(screen.getByRole("img", { name: /Сделана/ })).toHaveAttribute("data-status", "done");
    expect(screen.getByRole("img", { name: /Будет/ })).toHaveAttribute("data-status", "planned");
  });

  it("помечает пилюлями блокера и того, кто его ждёт", () => {
    draw({
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
    });
    expect(screen.getByText("блокер")).toBeInTheDocument();
    expect(screen.getByText("ждёт: Логотип")).toBeInTheDocument();
  });

  it("свёрнутая категория прячет свои задачи, развёрнутая возвращает", async () => {
    draw(STATE, "ru");
    expect(screen.getByRole("img", { name: /Логотип/ })).toBeInTheDocument();

    const chevron = screen.getByRole("button", { name: /Свернуть или развернуть «Дизайн»/ });
    await userEvent.click(chevron);
    expect(screen.queryByRole("img", { name: /Логотип/ })).not.toBeInTheDocument();

    await userEvent.click(chevron);
    expect(screen.getByRole("img", { name: /Логотип/ })).toBeInTheDocument();
  });

  it("окно ленты дотягивается до дедлайна, даже если задачи кончились раньше", () => {
    const { container } = draw(STATE);
    // Дедлайн 1 июня и окончание проекта 8 июня обязаны быть на ленте: иначе
    // красная вертикаль рисуется за краем и её не видно.
    expect(container.querySelector('[data-day="2026-06-08"]')).toBeInTheDocument();
  });

  it("панель масштаба работает и говорит на языке интерфейса", async () => {
    const { container } = drawWithToolbar("ru");
    const month = screen.getByRole("button", { name: "Месяц" });

    expect(screen.getByRole("button", { name: "Неделя" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(month);

    expect(month).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".gantt")).toHaveClass("gantt--month");
    expect(screen.getByRole("button", { name: "Сегодня" })).toBeInTheDocument();
  });
});
