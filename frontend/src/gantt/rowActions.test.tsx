import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  STATE,
  THREE_TASKS,
  captureMutations,
  projectFixtures,
  renderProject,
} from "../test/project";
import { server } from "../test/server";
import { renderWithProviders } from "../test/utils";
import { Gantt } from "./Gantt";

/**
 * То, что строка ленты показывает при наведении.
 *
 * Раньше строка отвечала только на «когда»: имя, даты, полоска. Всё
 * остальное — сколько об этой задаче уже сказано, кто её делает, и «а сюда бы
 * ещё одну строку» — жило в карточке, то есть открывалось по одной задаче за
 * раз. Планом же занимаются, глядя на весь список сразу.
 */

beforeEach(projectFixtures);

/** Счётчик реплик на строке названной задачи. */
function comments(name: string) {
  return screen.queryByRole("img", { name: new RegExp(`Обсуждение «${name}»`) });
}

describe("обсуждение на строке", () => {
  it("показывает число реплик, не открывая карточку", async () => {
    server.use(
      http.get("/api/projects/p1/comments/counts", () => HttpResponse.json({ t1: 3 })),
    );
    renderProject();

    expect(await screen.findByLabelText("Обсуждение «Логотип»: 3 реплики")).toHaveTextContent(
      "3",
    );
  });

  it("щелчок по счётчику открывает карточку сразу на обсуждении", async () => {
    server.use(
      http.get("/api/projects/p1/comments/counts", () => HttpResponse.json({ t1: 1 })),
      http.get("/api/projects/p1/comments", () => HttpResponse.json([])),
    );
    renderProject();

    await userEvent.click(await screen.findByLabelText("Обсуждение «Логотип»: 1 реплика"));

    const panel = await screen.findByRole("complementary", { name: /Логотип/ });
    // Именно обсуждение, а не свойства: счётчик, приводящий не туда, куда
    // обещал, — это лишний щелчок по вкладке на каждое открытие.
    expect(within(panel).getByRole("tab", { name: "Комментарии" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("у задачи без реплик числа нет — есть только сам знак", async () => {
    renderProject();
    await screen.findByRole("button", { name: /Логотип/ });

    // «0» на каждой из ста строк — рябь, в которой не видно единственной
    // строки с разговором. Знак при этом на месте: им обсуждение и открывают.
    expect(comments("Логотип")).toHaveTextContent("");
  });

  it("гостю число видно, а щёлкать по нему нечем", () => {
    // Публичная страница: карточки задачи там нет вовсе, и знак перестаёт быть
    // органом управления — остаётся подписью с числом (см. Bar в Row.tsx, где
    // тем же образом перестаёт быть кнопкой сама полоска).
    renderWithProviders(
      <Gantt projectId="p1" state={STATE} commentCounts={new Map([["t1", 2]])} />,
      { locale: "ru" },
    );

    const badge = screen.getByLabelText("Обсуждение «Логотип»: 2 реплики");
    expect(badge).toHaveTextContent("2");
    expect(badge).not.toHaveClass("is-clickable");
  });

  it("гостю пустого знака нет: щёлкать по нему всё равно нечем", () => {
    renderWithProviders(<Gantt projectId="p1" state={STATE} />, { locale: "ru" });

    expect(comments("Логотип")).not.toBeInTheDocument();
  });
});

describe("исполнители со строки", () => {
  it("назначает человека, не открывая карточку", async () => {
    const sent = captureMutations();
    renderProject();
    await screen.findByRole("button", { name: /Логотип/ });

    await userEvent.click(screen.getByRole("button", { name: "Исполнители" }));
    await userEvent.click(await screen.findByRole("button", { name: /Мария/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].op).toEqual({ type: "assign_user", task_id: "t1", user_id: "u2" });
    // Панель не закрывается после выбора: на задачу сажают двоих и троих подряд.
    expect(screen.getByTestId("assign-t1")).toBeInTheDocument();
  });

  it("повторный выбор снимает назначение", async () => {
    const sent = captureMutations();
    renderProject();
    await screen.findByRole("button", { name: /Логотип/ });

    await userEvent.click(screen.getByRole("button", { name: "Исполнители" }));
    await userEvent.click(await screen.findByRole("button", { name: /Мария/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: /Мария/ }));

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].op).toEqual({ type: "unassign_user", task_id: "t1", user_id: "u2" });
  });

  it("Esc закрывает список, ничего не назначив", async () => {
    const sent = captureMutations();
    renderProject();
    await screen.findByRole("button", { name: /Логотип/ });

    await userEvent.click(screen.getByRole("button", { name: "Исполнители" }));
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByTestId("assign-t1")).not.toBeInTheDocument());
    expect(sent).toHaveLength(0);
  });

  it("читателю кнопки нет: назначать он не может", async () => {
    renderProject(undefined, { canWrite: false });
    await screen.findByRole("button", { name: /Логотип/ });

    expect(screen.queryByRole("button", { name: "Исполнители" })).not.toBeInTheDocument();
  });
});

describe("вставка строки посередине", () => {
  /** «Плюс» на верхней границе строки названной задачи. */
  function insert(name: string) {
    return screen.getByTitle(`Добавить задачу перед «${name}»`);
  }

  it("открывает поле ввода прямо над той строкой, на которую указали", async () => {
    renderProject(THREE_TASKS);
    await screen.findByRole("button", { name: /Первая/ });

    await userEvent.click(insert("Вторая"));

    const field = screen.getByRole("textbox", { name: "Новая задача в «Дизайн»" });
    expect(field).toHaveFocus();
    // Порядок строк в разметке — это и есть порядок ленты: поле стоит между
    // первой и второй, а не в конце категории.
    const names = [...document.querySelectorAll(".gantt__row")].map(
      (row) =>
        row.querySelector(".gantt__label-name")?.textContent ??
        (row.querySelector("input") === null ? null : "поле"),
    );
    expect(names.filter(Boolean)).toEqual([
      "Дизайн",
      "Первая",
      "поле",
      "Вторая",
      "Третья",
      "Разработка",
    ]);
  });

  it("задача уходит на номер той строки, перед которой её завели", async () => {
    const sent = captureMutations();
    renderProject(THREE_TASKS);
    await screen.findByRole("button", { name: /Первая/ });

    await userEvent.click(insert("Третья"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Новая задача в «Дизайн»" }),
      "Между{Enter}",
    );

    await waitFor(() => expect(sent).toHaveLength(1));
    // Одна операция, а не «создать в конце» плюс «переставить»: человек сделал
    // одно движение, и отменяется оно одним нажатием.
    expect(sent[0].op).toMatchObject({ type: "create_task", name: "Между", position: 2 });
  });

  it("две подряд ложатся в набранном порядке, а не задом наперёд", async () => {
    const sent = captureMutations();
    renderProject(THREE_TASKS);
    await screen.findByRole("button", { name: /Первая/ });

    await userEvent.click(insert("Вторая"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Новая задача в «Дизайн»" }),
      "а{Enter}б{Enter}",
    );

    await waitFor(() => expect(sent).toHaveLength(2));
    // Первая заняла номер «Второй» и сдвинула её вниз — значит, следующая
    // встаёт на номер ниже, иначе «б» оказалась бы над «а».
    expect(sent.map((row) => [row.op.name, row.op.position])).toEqual([
      ["а", 1],
      ["б", 2],
    ]);
  });

  it("«плюс» на строке категории по-прежнему кладёт задачу в конец", async () => {
    const sent = captureMutations();
    renderProject(THREE_TASKS);
    await screen.findByRole("button", { name: /Первая/ });

    await userEvent.click(screen.getByRole("button", { name: "Добавить задачу в «Дизайн»" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Новая задача в «Дизайн»" }),
      "Последняя{Enter}",
    );

    await waitFor(() => expect(sent).toHaveLength(1));
    // Номер не назван вовсе: конец списка знает сервер, и вкладке его считать
    // не за чем.
    expect(sent[0].op).not.toHaveProperty("position");
  });

  it("читателю «плюса» на границе строк нет", async () => {
    renderProject(THREE_TASKS, { canWrite: false });
    await screen.findByRole("button", { name: /Первая/ });

    expect(screen.queryByTitle(/Добавить задачу перед/)).not.toBeInTheDocument();
  });
});
