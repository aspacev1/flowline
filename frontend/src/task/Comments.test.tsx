import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";

const THREAD = [
  {
    id: "k1",
    task_id: "t1",
    body: "Клиент просит другой знак",
    created_at: "2026-03-05T10:00:00+00:00",
    author: { id: "u2", name: "Мария" },
    guest_name: null,
  },
  {
    id: "k2",
    task_id: "t1",
    body: "А когда сдача?",
    created_at: "2026-03-06T10:00:00+00:00",
    author: null,
    guest_name: "Нигяр",
  },
];

/**
 * Открывает карточку и отдаёт саму ветку обсуждения, а не карточку целиком.
 *
 * Границы важны: имя «Мария» есть и среди исполнителей на той же карточке, и
 * поиск по всей карточке нашёл бы двух — то есть проверял бы не подпись под
 * репликой, а совпадение имён.
 */
async function openCard() {
  renderProject();
  await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
  return screen.findByRole("complementary");
}

async function openThread() {
  const panel = await openCard();
  return within(panel).getByRole("region", { name: "Обсуждение" });
}

describe("обсуждение задачи", () => {
  beforeEach(() => {
    projectFixtures();
  });

  it("показывает реплики с подписями авторов", async () => {
    server.use(http.get("/api/projects/p1/comments", () => HttpResponse.json(THREAD)));

    const thread = await openThread();

    expect(await within(thread).findByText("Клиент просит другой знак")).toBeInTheDocument();
    expect(within(thread).getByText("Мария")).toBeInTheDocument();
  });

  it("отличает гостя от участника с аккаунтом", async () => {
    server.use(http.get("/api/projects/p1/comments", () => HttpResponse.json(THREAD)));

    const thread = await openThread();
    const guest = await within(thread).findByText(/Нигяр/);

    // Пометка рядом с именем, а не вместо него: гостя зовут по имени, но
    // читатель обязан видеть, что аккаунта за ним нет.
    expect(guest.textContent).toMatch(/гость/i);
  });

  it("отправляет реплику и показывает её после ответа сервера", async () => {
    const sent: unknown[] = [];
    // Заглушка помнит отправленное: без этого перезапрос после успеха вернул
    // бы прежнюю ветку, и тест проверял бы не появление реплики, а то, что
    // она успела мелькнуть.
    let stored = [...THREAD];
    server.use(
      http.get("/api/projects/p1/comments", () => HttpResponse.json(stored)),
      http.post("/api/projects/p1/comments", async ({ request }) => {
        const body = await request.json();
        sent.push(body);
        const created = {
          id: "k3",
          task_id: "t1",
          body: (body as { body: string }).body,
          created_at: "2026-03-07T10:00:00+00:00",
          author: { id: "u1", name: "Алексей" },
          guest_name: null,
        };
        stored = [...stored, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const thread = await openThread();
    await userEvent.type(within(thread).getByLabelText(/Комментарий/i), "Беру в работу");
    await userEvent.click(within(thread).getByRole("button", { name: /Отправить/i }));

    expect(await within(thread).findByText("Беру в работу")).toBeInTheDocument();
    expect(sent).toEqual([{ body: "Беру в работу", task_id: "t1" }]);
  });

  it("очищает поле после отправки", async () => {
    server.use(
      http.get("/api/projects/p1/comments", () => HttpResponse.json([])),
      http.post("/api/projects/p1/comments", () =>
        HttpResponse.json(
          {
            id: "k3",
            task_id: "t1",
            body: "Готово",
            created_at: "2026-03-07T10:00:00+00:00",
            author: { id: "u1", name: "Алексей" },
            guest_name: null,
          },
          { status: 201 },
        ),
      ),
    );

    const thread = await openThread();
    const field = within(thread).getByLabelText(/Комментарий/i);
    await userEvent.type(field, "Готово");
    await userEvent.click(within(thread).getByRole("button", { name: /Отправить/i }));

    await waitFor(() => expect(field).toHaveValue(""));
  });

  it("объясняет отказ словами и не теряет набранный текст", async () => {
    server.use(
      http.get("/api/projects/p1/comments", () => HttpResponse.json([])),
      http.post("/api/projects/p1/comments", () =>
        HttpResponse.json({ detail: "comment_empty" }, { status: 422 }),
      ),
    );

    const thread = await openThread();
    const field = within(thread).getByLabelText(/Комментарий/i);
    await userEvent.type(field, "  ");
    await userEvent.click(within(thread).getByRole("button", { name: /Отправить/i }));

    expect(await within(thread).findByRole("alert")).toHaveTextContent(/пуст/i);
    // Текст остаётся в поле: отказ — повод исправить реплику, а не набрать
    // её заново.
    expect(field).toHaveValue("  ");
  });

  it("не рисует ветку, если сервер её не отдал", async () => {
    server.use(
      http.get("/api/projects/p1/comments", () =>
        HttpResponse.json({ detail: "project_not_found" }, { status: 404 }),
      ),
    );

    // Карточка целиком, а не ветка: блока обсуждения здесь нет вовсе, и
    // искать поле внутри него было бы нечем.
    const panel = await openCard();

    await waitFor(() =>
      expect(within(panel).queryByRole("region", { name: "Обсуждение" })).not.toBeInTheDocument(),
    );
    // Карточка выше при этом работает как работала.
    expect(within(panel).getByLabelText("Название")).toBeInTheDocument();
  });
});
