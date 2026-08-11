import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { STATE } from "../test/project";
import { server } from "../test/server";
import { renderApp } from "../test/utils";

/**
 * Страница по публичной ссылке.
 *
 * Гость приходит без сессии: ответов про профиль и организацию здесь нет
 * вовсе, и это часть проверки — страница не должна их спрашивать.
 */

// Внутренней заметки в ответе сервера гостю нет: он её не присылает. Здесь она
// убрана из оснастки ровно поэтому, а не для удобства.
const { internal_note: _hidden, ...GUEST_TASK } = STATE.tasks[0];

const PUBLIC = {
  ...STATE,
  tasks: [GUEST_TASK],
  org_name: "Şəhər Studiyası",
  comments_enabled: true,
};

/**
 * Гость по ссылке — это человек без сессии.
 *
 * Приложение всё равно спрашивает, кто вошёл, и получает честное «никто»:
 * страница обязана работать именно в этом состоянии, а не только у того, кто
 * случайно оказался залогинен.
 */
beforeEach(() => {
  server.use(
    http.get("/api/auth/me", () =>
      HttpResponse.json({ detail: "not_authenticated" }, { status: 401 }),
    ),
  );
});

function publicFixtures(overrides: Partial<typeof PUBLIC> = {}) {
  const posted: Record<string, unknown>[] = [];
  const comments = [
    {
      id: "c1",
      task_id: null,
      body: "Держим сроки",
      created_at: "2026-03-05T10:00:00+00:00",
      author_name: "Алексей",
      is_guest: false,
    },
  ];
  server.use(
    http.get("/api/public/tok", () => HttpResponse.json({ ...PUBLIC, ...overrides })),
    http.get("/api/public/tok/comments", () => HttpResponse.json(comments)),
    http.post("/api/public/tok/comments", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posted.push(body);
      const entry = {
        id: "c2",
        task_id: null,
        body: String(body.body),
        created_at: "2026-03-05T11:00:00+00:00",
        author_name: String(body.guest_name),
        is_guest: true,
      };
      comments.push(entry);
      return HttpResponse.json(entry, { status: 201 });
    }),
  );
  return posted;
}

describe("публичная страница", () => {
  it("показывает диаграмму и комментарии, но не внутренние заметки", async () => {
    publicFixtures();
    renderApp({ route: "/p/seher-studiyasi/redizayn?s=tok" });

    expect(await screen.findByRole("heading", { name: "Редизайн" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Логотип/ })).toBeInTheDocument();
    expect(await screen.findByText("Держим сроки")).toBeInTheDocument();
    // Поля заметки нет вовсе: сервер её не прислал, и рисовать нечего.
    expect(screen.queryByLabelText(/заметка/i)).toBeNull();
  });

  it("не даёт инструментов правки", async () => {
    publicFixtures();
    renderApp({ route: "/p/seher-studiyasi/redizayn?s=tok" });
    await screen.findByRole("button", { name: /Логотип/ });

    // Ни создания категорий, ни утверждения плана, ни отмены: гость смотрит.
    expect(screen.queryByRole("button", { name: /Утвердить/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Отменить/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Добавить задачу/ })).toBeNull();
  });

  it("гость подписывается именем, и его реплика отличается от реплики участника", async () => {
    const posted = publicFixtures();
    renderApp({ route: "/p/seher-studiyasi/redizayn?s=tok" });

    await userEvent.type(await screen.findByLabelText("Ваше имя"), "Мария");
    await userEvent.type(screen.getByLabelText("Комментарий"), "А успеем до июня?");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() =>
      expect(posted).toEqual([{ body: "А успеем до июня?", guest_name: "Мария" }]),
    );
    expect(await screen.findByText("(гость)")).toBeInTheDocument();
  });

  it("с выключенными комментариями форма не показывается", async () => {
    publicFixtures({ comments_enabled: false });
    renderApp({ route: "/p/seher-studiyasi/redizayn?s=tok" });

    expect(await screen.findByText(/комментарии по этой ссылке выключены/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Комментарий")).toBeNull();
  });

  it("отозванная ссылка объясняется словами", async () => {
    server.use(
      http.get("/api/public/tok", () =>
        HttpResponse.json({ detail: "share_not_found" }, { status: 404 }),
      ),
    );
    renderApp({ route: "/p/seher-studiyasi/redizayn?s=tok" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/не работает или отозвана/);
  });

  it("адрес без токена не притворяется работающим", async () => {
    renderApp({ route: "/p/seher-studiyasi/redizayn" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/не работает или отозвана/);
  });
});
