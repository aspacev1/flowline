import { render, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { server } from "./test/server";

describe("App", () => {
  it("рисует каркас приложения", () => {
    // Приложение при старте спрашивает у сервера, кто пришёл: без ответа на
    // этот запрос каркас не поднимется вовсе.
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ detail: "not_authenticated" }, { status: 401 }),
      ),
    );

    render(<App />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
