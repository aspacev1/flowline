import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import { USER, renderApp } from "../test/utils";

const UNVERIFIED = { ...USER, email_verified: false };

describe("подтверждение адреса", () => {
  it("гасит ссылку из письма и говорит, что адрес подтверждён", async () => {
    const tokens: string[] = [];
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(UNVERIFIED)),
      http.post("/api/auth/verify-email", async ({ request }) => {
        const body = (await request.json()) as { token: string };
        tokens.push(body.token);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApp({ route: "/verify-email?token=abc123", locale: "ru" });

    expect(await screen.findByText(/адрес почты подтверждён/i)).toBeInTheDocument();
    // Ровно один запрос: StrictMode монтирует дерево дважды, а токен
    // одноразовый — второй запрос сменил бы успех ошибкой.
    expect(tokens).toEqual(["abc123"]);
  });

  it("не требует сессии: письмо читают в другом браузере", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ detail: "not_authenticated" }, { status: 401 }),
      ),
      http.post("/api/auth/verify-email", () => new HttpResponse(null, { status: 204 })),
    );

    renderApp({ route: "/verify-email?token=abc123", locale: "ru" });

    expect(await screen.findByText(/адрес почты подтверждён/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /вход/i })).not.toBeInTheDocument();
  });

  it("объясняет истёкшую ссылку словами, а не кодом", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(UNVERIFIED)),
      http.post("/api/auth/verify-email", () =>
        HttpResponse.json({ detail: "token_expired" }, { status: 400 }),
      ),
    );

    renderApp({ route: "/verify-email?token=stale", locale: "ru" });

    expect(await screen.findByText(/срок действия ссылки истёк/i)).toBeInTheDocument();
    expect(screen.queryByText(/token_expired/)).not.toBeInTheDocument();
  });

  it("предлагает вошедшему новое письмо вместо истёкшего", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(UNVERIFIED)),
      http.post("/api/auth/verify-email", () =>
        HttpResponse.json({ detail: "token_expired" }, { status: 400 }),
      ),
      http.post("/api/auth/verify-email/resend", () => HttpResponse.json({ sent: true })),
    );

    renderApp({ route: "/verify-email?token=stale", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /отправить письмо ещё раз/i }));

    expect(await screen.findByText(/письмо отправлено/i)).toBeInTheDocument();
  });

  it("не обещает письмо, которое не ушло", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(UNVERIFIED)),
      http.post("/api/auth/verify-email", () =>
        HttpResponse.json({ detail: "token_expired" }, { status: 400 }),
      ),
      // Почтовый сервер недоступен: сервер честно отвечает sent: false.
      http.post("/api/auth/verify-email/resend", () => HttpResponse.json({ sent: false })),
    );

    renderApp({ route: "/verify-email?token=stale", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /отправить письмо ещё раз/i }));

    expect(await screen.findByText(/не удалось отправить/i)).toBeInTheDocument();
    expect(screen.queryByText(/письмо отправлено/i)).not.toBeInTheDocument();
  });

  it("ссылка без токена не уходит на сервер", async () => {
    let asked = false;
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(UNVERIFIED)),
      http.post("/api/auth/verify-email", () => {
        asked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApp({ route: "/verify-email", locale: "ru" });

    expect(await screen.findByText(/в ссылке нет токена/i)).toBeInTheDocument();
    expect(asked).toBe(false);
  });
});
