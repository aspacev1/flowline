import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import { ORG, USER, renderApp } from "../test/utils";

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText(/почта/i), "a@b.c");
  await userEvent.type(screen.getByLabelText(/пароль/i), "s3cret-pass");
  await userEvent.click(screen.getByRole("button", { name: /войти/i }));
}

describe("экран входа", () => {
  it("впускает и показывает то, ради чего человек пришёл", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ detail: "not_authenticated" }, { status: 401 }),
      ),
      http.post("/api/auth/login", () => HttpResponse.json(USER)),
      http.get("/api/org", () => HttpResponse.json(ORG)),
      http.get("/api/projects", () => HttpResponse.json([])),
    );

    renderApp({ route: "/login" });
    await fillAndSubmit();

    expect(await screen.findByRole("heading", { name: "Проекты" })).toBeInTheDocument();
  });

  it("объясняет неверную пару переведённым текстом, а не кодом", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ detail: "not_authenticated" }, { status: 401 }),
      ),
      http.post("/api/auth/login", () =>
        HttpResponse.json({ detail: "bad_credentials" }, { status: 401 }),
      ),
    );

    renderApp({ route: "/login" });
    await fillAndSubmit();

    expect(await screen.findByText("Неверная почта или пароль")).toBeInTheDocument();
    expect(screen.queryByText("bad_credentials")).not.toBeInTheDocument();
  });
});
