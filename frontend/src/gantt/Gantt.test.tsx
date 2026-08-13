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
      status: "in_progress",
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
  afterEach(() => vi.restoreAllMocks());

  it("рисует задачу полоской нужной ширины", () => {
    draw(STATE);
    const bar = screen.getByRole("img", { name: /Логотип/ });
    // 4-10 марта — семь календарных дней
    expect(bar).toHaveStyle({ width: `${7 * DAY_WIDTH.day}px` });
  });

  it("ставит полоску в её день, а не в начало ленты", () => {
    const { container } = draw(STATE);
    // Окно открывается с первого числа месяца самой ранней задачи: 4 марта
    // отстоит от 1 марта на три дня.
    expect(container.querySelector<HTMLElement>(".gantt__bar")).toHaveStyle({
      left: `${3 * DAY_WIDTH.day}px`,
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

  it("ведёт линию «сегодня» серединой колонки и подписывает её в шапке", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 11, 9, 0)));
    try {
      const { container } = draw(STATE);
      // 11 марта — десятый день от начала окна (1 марта), и линия стоит
      // посередине его колонки, а не по её левому краю.
      expect(container.querySelector<HTMLElement>(".gantt__today")).toHaveStyle({
        left: `${10 * DAY_WIDTH.day + DAY_WIDTH.day / 2}px`,
      });
      const day = container.querySelector('.gantt__day[data-day="2026-03-11"]');
      expect(day).toHaveClass("is-today");
      expect(day?.querySelector(".gantt__day-today")).toHaveTextContent("Сегодня");
    } finally {
      vi.useRealTimers();
    }
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
    // По доступному имени, а не по содержимому: имя задачи живёт в левой
    // колонке и в aria-label полоски, самой полоске текст не принадлежит.
    const names = screen
      .getAllByRole("img", { name: /Первая|Вторая/ })
      .map((node) => node.getAttribute("aria-label"));
    expect(names).toEqual([
      expect.stringContaining("Первая"),
      expect.stringContaining("Вторая"),
    ]);
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

  it("легенда включается через меню «Вид» и расшифровывает статусы", async () => {
    const { container } = draw(STATE, "ru");
    // По умолчанию легенды нет — как в макете.
    expect(container.querySelector(".gantt__legend")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Вид" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Легенда" }));

    const legend = container.querySelector(".gantt__legend");
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveTextContent("В работе");
    expect(legend).toHaveTextContent("Готово");
    expect(legend).toHaveTextContent("Запланировано");
    expect(legend).toHaveTextContent("Заблокировано");
    expect(legend).toHaveTextContent("Блокер");
  });

  it("статус полоски — хранимое поле, а не вывод из дат", () => {
    // Смысл переезда на хранимый статус: «заблокировано» из дат не выводится,
    // а «запланировано» может стоять и на уже начатой по датам задаче.
    draw({
      ...STATE,
      tasks: [
        { ...STATE.tasks[0], id: "t1", name: "Идёт", position: 0, status: "in_progress" },
        {
          ...STATE.tasks[0],
          id: "t2",
          name: "Сделана",
          position: 1,
          status: "done",
          progress_pct: 100,
        },
        { ...STATE.tasks[0], id: "t3", name: "Будет", position: 2, status: "planned" },
        { ...STATE.tasks[0], id: "t4", name: "Встала", position: 3, status: "blocked" },
      ],
    });
    expect(screen.getByRole("img", { name: /Идёт/ })).toHaveAttribute(
      "data-status",
      "in_progress",
    );
    expect(screen.getByRole("img", { name: /Сделана/ })).toHaveAttribute("data-status", "done");
    expect(screen.getByRole("img", { name: /Будет/ })).toHaveAttribute("data-status", "planned");
    expect(screen.getByRole("img", { name: /Встала/ })).toHaveAttribute("data-status", "blocked");
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

  it("меню масштаба называет текущий масштаб и меняет его", async () => {
    const { container } = drawWithToolbar("ru");
    // Свёрнутое меню обязано называть выбранное само: иначе, в отличие от
    // прежнего ряда сегментов, текущий масштаб виден только раскрытым.
    const button = screen.getByRole("button", { name: "Масштаб: День" });
    expect(container.querySelector(".gantt")).toHaveClass("gantt--day");

    await userEvent.click(button);
    await userEvent.click(screen.getByRole("radio", { name: "Месяц" }));

    expect(container.querySelector(".gantt")).toHaveClass("gantt--month");
    expect(screen.getByRole("button", { name: "Масштаб: Месяц" })).toBeInTheDocument();
  });
});
