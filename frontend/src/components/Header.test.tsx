import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { server } from "../test/server";
import { ORG, USER, renderApp } from "../test/utils";

beforeEach(() => {
  server.use(
    http.get("/api/auth/me", () => HttpResponse.json(USER)),
    http.get("/api/org", () => HttpResponse.json(ORG)),
    http.get("/api/projects", () => HttpResponse.json([])),
  );
});

describe("шапка", () => {
  it("подписана названием организации, и оно не переводится", async () => {
    renderApp({ route: "/projects", locale: "ru" });

    expect(await screen.findByText("Şəhər Studiyası")).toBeInTheDocument();
  });

  it("показывает, какой язык включён сейчас", async () => {
    renderApp({ route: "/projects", locale: "ru" });

    expect(await screen.findByRole("button", { name: "RU", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AZ", pressed: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EN", pressed: false })).toBeInTheDocument();
  });

  it("здоровается с вошедшим только по имени, без фамилии", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ ...USER, name: "Алексей Смирнов" })),
    );

    renderApp({ route: "/projects", locale: "ru" });

    expect(await screen.findByText("Привет, Алексей")).toBeInTheDocument();
    expect(screen.queryByText("Привет, Алексей Смирнов")).not.toBeInTheDocument();
  });

  it("сворачивается по кнопке и запоминает выбор", async () => {
    renderApp({ route: "/projects", locale: "ru" });

    await userEvent.click(await screen.findByRole("button", { name: "Скрыть меню" }));

    // Кнопка сменила имя — колонка свёрнута, и выбор пережил бы перезагрузку.
    expect(screen.getByRole("button", { name: "Показать меню" })).toBeInTheDocument();
    expect(localStorage.getItem("planora.sidebar_collapsed")).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "Показать меню" }));

    expect(screen.getByRole("button", { name: "Скрыть меню" })).toBeInTheDocument();
    expect(localStorage.getItem("planora.sidebar_collapsed")).toBeNull();
  });
});
