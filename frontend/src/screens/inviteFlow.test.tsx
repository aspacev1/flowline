/**
 * Путь приглашённого целиком — через настоящий роутер и настоящие переходы.
 *
 * Экраны по отдельности эти сценарии не ловят: приглашение теряется не внутри
 * экрана, а на переходе между двумя, и увидеть это можно только пройдя цепочку
 * так же, как её проходит человек. Оба сценария ниже — не выдумка: приглашения
 * шлют на рабочие адреса, у которых аккаунт заведён давно, а пароль к нему
 * помнят не всегда.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { server } from "../test/server";
import { ORG, USER, renderApp } from "../test/utils";

const TOKEN = "inv-token-42";

const PREVIEW = {
  org_name: "Şəhər Studiyası",
  role: "editor",
  // Тот же адрес, что у профиля: иначе экран приглашения решит, что человек
  // вошёл не под тем аккаунтом, и предложит выйти вместо «Принять».
  email: USER.email,
  inviter_name: "Мария",
  expires_at: "2026-09-01T00:00:00+00:00",
};

/** Сессии нет, пока не вошли: первый `/api/auth/me` обязан ответить отказом. */
function anonymousUntilLogin() {
  let signedIn = false;
  server.use(
    http.get("/api/auth/me", () =>
      signedIn
        ? HttpResponse.json(USER)
        : HttpResponse.json({ detail: "not_authenticated" }, { status: 401 }),
    ),
    http.post("/api/auth/login", () => {
      signedIn = true;
      return HttpResponse.json(USER);
    }),
    http.get("/api/org", () => HttpResponse.json(ORG)),
    http.get("/api/projects", () => HttpResponse.json([])),
    http.get(`/api/invitations/${TOKEN}`, () => HttpResponse.json(PREVIEW)),
  );
}

async function logIn() {
  await userEvent.type(screen.getByLabelText(/почта/i), USER.email);
  await userEvent.type(screen.getByLabelText(/пароль/i), "s3cret-pass");
  await userEvent.click(screen.getByRole("button", { name: /^войти$/i }));
}

beforeEach(() => {
  localStorage.clear();
});

describe("путь приглашённого", () => {
  it("у кого аккаунт уже есть: регистрация отказывает, и вход возвращает к приглашению", async () => {
    anonymousUntilLogin();
    server.use(
      http.post("/api/auth/register", () =>
        HttpResponse.json({ detail: "email_taken" }, { status: 409 }),
      ),
    );

    renderApp({ route: `/invite/${TOKEN}` });

    // Экран приглашения: видно, куда зовут, ещё до всякого входа.
    await screen.findByRole("heading", { name: /приглашение/i });
    await userEvent.click(screen.getByRole("link", { name: /зарегистр/i }));

    // Форма подставила адрес приглашения и заперла его.
    await screen.findByRole("heading", { name: /регистрация/i });
    await userEvent.type(screen.getByLabelText(/имя/i), "Алексей");
    await userEvent.type(screen.getByLabelText(/пароль/i), "s3cret-pass");
    await userEvent.click(screen.getByRole("button", { name: /зарегистр/i }));
    expect(await screen.findByText("Этот адрес уже занят")).toBeInTheDocument();

    // Экран сам предлагает выход — и этот выход обязан нести приглашение.
    await userEvent.click(screen.getByRole("link", { name: /^войти$/i }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/login?invite=${TOKEN}`,
      ),
    );

    await logIn();

    // Раньше здесь был /projects прежней организации, а приглашение навсегда
    // оставалось в статусе «Ждёт».
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/invite/${TOKEN}`),
    );
    expect(
      await screen.findByRole("button", { name: /принять приглашение/i }),
    ).toBeInTheDocument();
  });

  it("кто забыл пароль: приглашение переживает письмо, которое строит сервер", async () => {
    anonymousUntilLogin();
    server.use(
      http.post("/api/auth/password/forgot", () => new HttpResponse(null, { status: 204 })),
      http.post("/api/auth/password/reset", () => new HttpResponse(null, { status: 204 })),
    );

    renderApp({ route: `/invite/${TOKEN}` });
    await screen.findByRole("heading", { name: /приглашение/i });
    await userEvent.click(screen.getByRole("link", { name: /^войти$/i }));

    await screen.findByRole("heading", { name: /^вход$/i });
    await userEvent.click(screen.getByRole("link", { name: /забыли пароль/i }));

    // Приглашение доехало до восстановления строкой запроса.
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/forgot-password?invite=${TOKEN}`,
      ),
    );
    await userEvent.type(screen.getByLabelText(/почта/i), USER.email);
    await userEvent.click(screen.getByRole("button", { name: /отправить письмо/i }));
    await screen.findByText(/письмо уже в пути/i);

    // Дальше человек уходит в почту и возвращается по ссылке, которую построил
    // сервер: приглашения в ней нет и быть не может — только токен сброса.
    renderApp({ route: "/reset-password?token=reset-token" });
    await userEvent.type(
      await screen.findByLabelText(/новый пароль/i),
      "brand-new-pass",
    );
    await userEvent.click(screen.getByRole("button", { name: /сохранить пароль/i }));
    await screen.findByText(/пароль изменён/i);

    // Ссылка «Войти» голая — приглашение подхватывает память.
    await userEvent.click(screen.getByRole("link", { name: /^войти$/i }));
    await logIn();

    await waitFor(() =>
      expect(screen.getAllByTestId("location").at(-1)).toHaveTextContent(
        `/invite/${TOKEN}`,
      ),
    );
  });

  it("мёртвая ссылка не запоминается и не всплывает при следующем входе", async () => {
    anonymousUntilLogin();
    server.use(
      http.get(`/api/invitations/${TOKEN}`, () =>
        HttpResponse.json({ detail: "invite_expired" }, { status: 409 }),
      ),
    );

    renderApp({ route: `/invite/${TOKEN}` });
    expect(await screen.findByText(/срок ссылки истёк/i)).toBeInTheDocument();

    expect(localStorage.getItem("planora.pending_invite")).toBeNull();
  });
});
