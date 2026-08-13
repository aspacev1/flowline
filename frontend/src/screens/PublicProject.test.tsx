import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import { renderApp } from "../test/utils";

const TOKEN = "sh4re-t0ken";
const ROUTE = `/p/acme/redizayn?s=${TOKEN}`;

const STATE = {
  id: "p1",
  name: "Редизайн",
  slug: "redizayn",
  deadline: "2026-06-01",
  project_end: "2026-06-08",
  calendar: { working_days: 31, holidays: [], extra_workdays: [] },
  categories: [{ id: "c1", name: "Дизайн", color: "#3b82f6", position: 0 }],
  tasks: [
    {
      id: "t1",
      category_id: "c1",
      name: "Логотип",
      description: "",
      start_date: "2026-03-04",
      end_date: "2026-03-10",
      duration_days: 5,
      criticality: "high",
      status: "in_progress",
      progress_pct: 40,
      position: 0,
      assignee_ids: [],
    },
  ],
  dependencies: [],
  org: { name: "Şəhər Studiyası", slug: "acme" },
  comments_enabled: true,
};

/**
 * Гость — человек без сессии: `/api/auth/me` отвечает ему отказом. Это не
 * оформление теста, а суть проверки: публичная страница обязана открыться
 * именно в таком состоянии, а не «если вдруг кто-то залогинен».
 */
function guestSession() {
  return http.get("/api/auth/me", () => new HttpResponse(null, { status: 401 }));
}

function publicProject(state: object = STATE) {
  return http.get("/api/public/acme/redizayn", ({ request }) => {
    // Токен обязан доехать до сервера: без него ссылка ничем не отличается
    // от угаданного адреса.
    if (new URL(request.url).searchParams.get("s") !== TOKEN) {
      return HttpResponse.json({ detail: "link_not_found" }, { status: 404 });
    }
    return HttpResponse.json(state);
  });
}

function noComments() {
  return http.get("/api/public/acme/redizayn/comments", () => HttpResponse.json([]));
}

describe("публичная страница", () => {
  it("открывает проект гостю без входа", async () => {
    server.use(guestSession(), publicProject(), noComments());

    renderApp({ route: ROUTE, locale: "ru" });

    expect(await screen.findByRole("heading", { name: "Редизайн", level: 1 })).toBeInTheDocument();
    // Название организации подписывает страницу: гость должен видеть, чей
    // это план. И оно не переводится — это содержимое пользователя.
    expect(screen.getByText("Şəhər Studiyası")).toBeInTheDocument();
    expect(screen.getAllByText("Логотип").length).toBeGreaterThan(0);
    // На вход его не увели: адрес остался публичным.
    expect(screen.getByTestId("location")).toHaveTextContent("/p/acme/redizayn");
  });

  it("не предлагает гостю ничего менять", async () => {
    server.use(guestSession(), publicProject(), noComments());

    renderApp({ route: ROUTE, locale: "ru" });
    await screen.findAllByText("Логотип");

    expect(screen.queryByRole("button", { name: "Новая категория" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Новая задача" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Поделиться" })).not.toBeInTheDocument();
  });

  it("показывает гостю сводку по проекту, но без расхождений с планом", async () => {
    server.use(guestSession(), noMembers(), publicProject(), noComments());

    renderApp({ route: ROUTE, locale: "ru" });

    const strip = await screen.findByRole("list", { name: "Сводка по проекту" });
    expect(within(strip).getByText("Всего задач")).toBeInTheDocument();
    // «Вне плана» считается по базовому плану, а версия плана и расхождения с
    // ним по ссылке не показываются вовсе. Ячейки нет — не ноль, а нет.
    expect(within(strip).queryByText("Вне плана")).not.toBeInTheDocument();
  });

  it("объясняет отозванную ссылку, а не показывает пустой экран", async () => {
    server.use(
      guestSession(),
      http.get("/api/public/acme/redizayn", () =>
        HttpResponse.json({ detail: "link_not_found" }, { status: 404 }),
      ),
    );

    renderApp({ route: ROUTE, locale: "ru" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ссылка не работает: её отозвали или в адресе опечатка",
    );
  });

  it("гость подписывает реплику именем и оно запоминается в браузере", async () => {
    const sent: Array<Record<string, unknown>> = [];
    server.use(
      guestSession(),
      publicProject(),
      noComments(),
      http.post("/api/public/acme/redizayn/comments", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        sent.push(body);
        return HttpResponse.json(
          {
            id: "cm1",
            task_id: null,
            author: { name: body.name, guest: true },
            body: body.body,
            created_at: "2026-03-05T10:00:00+00:00",
          },
          { status: 201 },
        );
      }),
    );

    renderApp({ route: ROUTE, locale: "ru" });
    await screen.findAllByText("Логотип");

    await userEvent.type(screen.getByLabelText("Ваше имя"), "Нигяр");
    await userEvent.type(screen.getByLabelText("Комментарий"), "Сроки устраивают");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ name: "Нигяр", body: "Сроки устраивают" });
    // Имя запоминается в браузере: второй раз гость его не вводит.
    expect(localStorage.getItem("planora.guest_name")).toBe("Нигяр");
  });

  it("гостевая реплика видна с пометкой «гость»", async () => {
    server.use(
      guestSession(),
      publicProject(),
      http.get("/api/public/acme/redizayn/comments", () =>
        HttpResponse.json([
          {
            id: "cm1",
            task_id: null,
            author: { name: "Нигяр", guest: true },
            body: "Когда будет макет?",
            created_at: "2026-03-05T10:00:00+00:00",
          },
          {
            id: "cm2",
            task_id: null,
            author: { name: "Алексей", guest: false },
            body: "К пятнице",
            created_at: "2026-03-05T11:00:00+00:00",
          },
        ]),
      ),
    );

    renderApp({ route: ROUTE, locale: "ru" });

    const guest = await screen.findByText("Когда будет макет?");
    // Пометка стоит у гостя и только у него: реплика человека с аккаунтом
    // отличается по смыслу, и различие должно быть словом, а не оттенком.
    expect(guest.closest("li")).toHaveTextContent("гость");
    expect(screen.getByText("К пятнице").closest("li")).not.toHaveTextContent("гость");
  });

  it("выключенные комментарии закрывают форму, но не ленту", async () => {
    server.use(
      guestSession(),
      publicProject({ ...STATE, comments_enabled: false }),
      http.get("/api/public/acme/redizayn/comments", () =>
        HttpResponse.json([
          {
            id: "cm1",
            task_id: null,
            author: { name: "Нигяр", guest: true },
            body: "Сказанное вчера",
            created_at: "2026-03-05T10:00:00+00:00",
          },
        ]),
      ),
    );

    renderApp({ route: ROUTE, locale: "ru" });

    expect(await screen.findByText("Сказанное вчера")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отправить" })).not.toBeInTheDocument();
    expect(screen.getByText("Владелец проекта закрыл комментарии")).toBeInTheDocument();
  });

  it("не спрашивает состав организации: гостю его и не отдадут", async () => {
    const asked: string[] = [];
    server.use(
      guestSession(),
      publicProject(),
      noComments(),
      http.get("/api/org/members", () => {
        asked.push("members");
        return HttpResponse.json([]);
      }),
    );

    renderApp({ route: ROUTE, locale: "ru" });
    await screen.findAllByText("Логотип");

    // Имена исполнителей для карточки наведения спрашивает рабочий экран и
    // передаёт их ленте пропсом. Спроси их лента сама — публичная страница
    // ходила бы за ними тоже и получала отказ на каждом открытии ссылки.
    expect(asked).toEqual([]);
  });

  it("язык переключается прямо на странице", async () => {
    server.use(guestSession(), publicProject(), noComments());

    renderApp({ route: ROUTE, locale: "ru" });
    await screen.findAllByText("Логотип");

    await userEvent.click(screen.getByRole("button", { name: "EN" }));

    // У гостя нет профиля, из которого можно было бы взять язык, а клиент
    // может не совпадать по языку с командой.
    expect(await screen.findByText("Comments")).toBeInTheDocument();
  });
});
