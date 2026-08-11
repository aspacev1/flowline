import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import { ORG, USER, renderApp } from "../test/utils";

describe("экран проектов", () => {
  it("переключение языка меняет интерфейс, но не данные", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(USER)),
      http.get("/api/org", () => HttpResponse.json(ORG)),
      http.get("/api/projects", () =>
        HttpResponse.json([{ id: "p1", name: "Şəhər Layihəsi", slug: "seher-layihesi" }]),
      ),
    );

    renderApp({ route: "/projects", locale: "ru" });
    expect(await screen.findByText("Проекты")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "AZ" }));

    expect(await screen.findByText("Layihələr")).toBeInTheDocument();
    // название проекта — содержимое пользователя, оно не переводится
    expect(screen.getByText("Şəhər Layihəsi")).toBeInTheDocument();
  });

  it("пустой список объясняет, что делать дальше", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(USER)),
      http.get("/api/org", () => HttpResponse.json(ORG)),
      http.get("/api/projects", () => HttpResponse.json([])),
    );

    renderApp({ route: "/projects", locale: "ru" });

    expect(await screen.findByText(/пока ни одного проекта/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /создать проект/i })).toBeInTheDocument();
  });

  it("отказ сервера объясняется словами, а не пустым экраном", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json(USER)),
      http.get("/api/org", () => HttpResponse.json(ORG)),
      http.get("/api/projects", () =>
        HttpResponse.json({ detail: "no_organization" }, { status: 403 }),
      ),
    );

    renderApp({ route: "/projects", locale: "ru" });

    expect(await screen.findByText(/не состоите ни в одной организации/i)).toBeInTheDocument();
  });
});
