import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { STATE } from "../test/project";
import { renderApp } from "../test/utils";
import { server } from "../test/server";

const ADDRESS = "/api/public/seher-studiyasi/redizayn";

/**
 * Состояние глазами гостя: ни заметки, ни исполнителей — сервер их не
 * присылает вовсе. Оснастка обязана быть такой же, иначе тест на утечку
 * заметки проверял бы разметку, которой в бою неоткуда взяться.
 */
const PUBLIC_STATE = {
  ...STATE,
  comments_enabled: true,
  tasks: STATE.tasks.map(({ internal_note, assignee_ids, ...task }) => {
    void internal_note;
    void assignee_ids;
    return task;
  }),
};

const THREAD = [
  {
    id: "k1",
    task_id: null,
    body: "Когда сдача?",
    created_at: "2026-03-06T10:00:00+00:00",
    author: null,
    guest_name: "Нигяр",
  },
];

function publicFixtures(overrides: Partial<typeof PUBLIC_STATE> = {}) {
  const sent: unknown[] = [];
  server.use(
    // Ровно то, что видит гость в бою: сессии у него нет, и проверка профиля
    // отвечает отказом. Страница обязана открыться именно так, а не только
    // при удобно подставленном профиле.
    http.get("/api/auth/me", () =>
      HttpResponse.json({ detail: "not_authenticated" }, { status: 401 }),
    ),
    http.get(ADDRESS, () => HttpResponse.json({ ...PUBLIC_STATE, ...overrides })),
    http.get(`${ADDRESS}/comments`, () => HttpResponse.json(THREAD)),
    http.post(`${ADDRESS}/comments`, async ({ request }) => {
      const body = await request.json();
      sent.push(body);
      return HttpResponse.json(
        {
          id: "k2",
          task_id: null,
          body: (body as { body: string }).body,
          created_at: "2026-03-07T10:00:00+00:00",
          author: null,
          guest_name: (body as { guest_name: string }).guest_name,
        },
        { status: 201 },
      );
    }),
  );
  return sent;
}

function open() {
  return renderApp({ route: "/p/seher-studiyasi/redizayn", locale: "ru" });
}

describe("публичная страница", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("открывается без сессии и показывает диаграмму", async () => {
    publicFixtures();
    open();

    // Картинка, а не кнопка: карточки задачи здесь нет, и полоска не должна
    // забирать фокус обещанием действия, которого нет.
    expect(await screen.findByRole("img", { name: /Логотип, 4 марта/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Логотип/ })).not.toBeInTheDocument();
  });

  it("не показывает ни внутренних заметок, ни кнопок правки", async () => {
    publicFixtures();
    open();

    await screen.findByRole("img", { name: /Логотип/ });
    expect(screen.queryByText(/Внутренняя заметка/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Создать категорию/i })).not.toBeInTheDocument();
  });

  it("не показывает форму, если владелец выключил комментарии", async () => {
    publicFixtures({ comments_enabled: false });
    open();

    await screen.findByRole("img", { name: /Логотип/ });
    expect(screen.queryByLabelText(/Комментарий/i)).not.toBeInTheDocument();
  });

  it("спрашивает имя при первой реплике и шлёт его вместе с текстом", async () => {
    const sent = publicFixtures();
    open();

    await userEvent.type(await screen.findByLabelText(/Ваше имя/i), "Нигяр");
    await userEvent.type(screen.getByLabelText(/Комментарий/i), "Спасибо!");
    await userEvent.click(screen.getByRole("button", { name: /Отправить/i }));

    await waitFor(() =>
      expect(sent).toEqual([{ body: "Спасибо!", guest_name: "Нигяр" }]),
    );
  });

  it("больше не спрашивает имя, если браузер его помнит", async () => {
    localStorage.setItem("flowline_guest_name", "Нигяр");
    publicFixtures();
    open();

    await screen.findByRole("img", { name: /Логотип/ });
    expect(screen.queryByLabelText(/Ваше имя/i)).not.toBeInTheDocument();
  });

  it("подписывает реплику гостя пометкой, а не только именем", async () => {
    publicFixtures();
    open();

    const thread = await screen.findByRole("region", { name: /Обсуждение/i });
    expect((await within(thread).findByText(/Нигяр/)).textContent).toMatch(/гость/i);
  });

  it("объясняет отозванную ссылку, а не показывает пустой экран", async () => {
    publicFixtures();
    server.use(
      http.get(ADDRESS, () =>
        HttpResponse.json({ detail: "project_not_found" }, { status: 404 }),
      ),
    );
    open();

    expect(await screen.findByRole("alert")).toHaveTextContent(/не действует/i);
  });

  it("объясняет словами, что реплик слишком много", async () => {
    publicFixtures();
    server.use(
      http.post(`${ADDRESS}/comments`, () =>
        HttpResponse.json({ detail: "too_many_comments" }, { status: 429 }),
      ),
    );
    open();

    await userEvent.type(await screen.findByLabelText(/Ваше имя/i), "Нигяр");
    await userEvent.type(screen.getByLabelText(/Комментарий/i), "ещё");
    await userEvent.click(screen.getByRole("button", { name: /Отправить/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Подождите/i);
  });
});
