import { screen } from "@testing-library/react";
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

  it("здоровается с вошедшим по имени", async () => {
    renderApp({ route: "/projects", locale: "ru" });

    expect(await screen.findByText("Привет, Алексей")).toBeInTheDocument();
  });
});
