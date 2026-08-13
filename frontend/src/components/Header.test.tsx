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

  it("ведёт в настройки одним пунктом, а не тремя шестерёнками подряд", async () => {
    renderApp({ route: "/projects", locale: "ru" });

    expect(await screen.findByRole("link", { name: "Настройки" })).toHaveAttribute(
      "href",
      "/settings",
    );
    // Организация, участники и профиль стали вкладками внутри — своих пунктов
    // в колонке у них больше нет.
    expect(screen.queryByRole("link", { name: "Организация" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Профиль" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Команда" })).toBeNull();
    // Язык — настройка, и переключатель уехал вместе с ней на экран профиля.
    expect(screen.queryByRole("group", { name: "Язык интерфейса" })).toBeNull();
  });

  it("не здоровается: разделы стоят сразу под названием организации", async () => {
    server.use(
      http.get("/api/auth/me", () => HttpResponse.json({ ...USER, name: "Алексей Смирнов" })),
    );

    renderApp({ route: "/projects", locale: "ru" });

    const projects = await screen.findByRole("link", { name: "Проекты" });
    expect(screen.queryByText(/Привет/)).toBeNull();
    // Между логотипом и первым разделом не осталось строки с именем: колонка
    // начинается организацией и сразу переходит к работе.
    const sidebar = projects.closest(".sidebar")!;
    expect(sidebar.querySelector(".sidebar__user")).toBeNull();
  });

  it("подписывает выход значком, как и остальные пункты колонки", async () => {
    renderApp({ route: "/projects", locale: "ru" });

    const logout = await screen.findByRole("button", { name: "Выйти" });
    expect(logout.querySelector("svg.sidebar__icon")).not.toBeNull();
  });

  it("сворачивается щелчком по логотипу и запоминает выбор", async () => {
    renderApp({ route: "/projects", locale: "ru" });

    // Сворачивает сам логотип: отдельной кнопки со стрелкой в колонке нет.
    const logo = await screen.findByRole("button", { name: "Скрыть меню" });
    expect(await screen.findByText("Şəhər Studiyası")).toBe(logo.lastElementChild);

    await userEvent.click(logo);

    // Кнопка сменила имя — колонка свёрнута, и выбор пережил бы перезагрузку.
    expect(screen.getByRole("button", { name: "Показать меню" })).toBeInTheDocument();
    expect(localStorage.getItem("planora.sidebar_collapsed")).toBe("1");

    await userEvent.click(screen.getByRole("button", { name: "Показать меню" }));

    expect(screen.getByRole("button", { name: "Скрыть меню" })).toBeInTheDocument();
    expect(localStorage.getItem("planora.sidebar_collapsed")).toBeNull();
  });
});
