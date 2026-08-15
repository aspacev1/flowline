import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";

const URL = "https://planora.example.com/p/seher-studiyasi/redizayn?s=sh4re-t0ken";

const PUBLISHED = {
  allowed: true,
  url: URL,
  comments_enabled: true,
  created_at: "2026-03-05T10:00:00+00:00",
};

const UNPUBLISHED = { allowed: true, url: null, comments_enabled: false, created_at: null };

describe("панель публикации в настройках проекта", () => {
  beforeEach(projectFixtures);

  // Сервер всегда отвечает объектом, где «не опубликован» — это url: null.
  // Панель обязана ветвиться по адресу, а не по отсутствию ответа: иначе
  // неопубликованный проект показывает пустое поле ссылки и кнопки
  // «Перевыпустить»/«Закрыть ссылку», которым нечего перевыпускать.
  it("неопубликованный проект предлагает публикацию, а не пустой адрес", async () => {
    server.use(http.get("/api/projects/p1/share", () => HttpResponse.json(UNPUBLISHED)));
    renderProject(undefined, { route: "/projects/p1/settings" });

    expect(await screen.findByText("Проект наружу не показан")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Опубликовать" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Адрес ссылки")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Перевыпустить" })).not.toBeInTheDocument();
  });

  it("опубликованный проект показывает адрес и кнопки управления ссылкой", async () => {
    server.use(http.get("/api/projects/p1/share", () => HttpResponse.json(PUBLISHED)));
    renderProject(undefined, { route: "/projects/p1/settings" });

    expect(await screen.findByLabelText("Адрес ссылки")).toHaveValue(URL);
    expect(screen.getByRole("button", { name: "Перевыпустить" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Опубликовать" })).not.toBeInTheDocument();
  });

  it("перевыпуск идёт отдельным вызовом, а не повторной публикацией", async () => {
    const rotated = { ...PUBLISHED, url: `${URL}-2` };
    let issued = 0;
    server.use(
      http.get("/api/projects/p1/share", () => HttpResponse.json(PUBLISHED)),
      // Повторный POST на /share сервер отбивает 409-м: если панель пойдёт
      // сюда вместо /share/rotate, тест увидит это по счётчику.
      http.post("/api/projects/p1/share", () => {
        issued += 1;
        return HttpResponse.json({ code: "share_already_exists" }, { status: 409 });
      }),
      http.post("/api/projects/p1/share/rotate", () => HttpResponse.json(rotated)),
    );
    renderProject(undefined, { route: "/projects/p1/settings" });

    await userEvent.click(await screen.findByRole("button", { name: "Перевыпустить" }));

    await waitFor(() => expect(screen.getByLabelText("Адрес ссылки")).toHaveValue(rotated.url));
    expect(issued).toBe(0);
  });

  it("в закрытой установке публикация не предлагается вовсе", async () => {
    server.use(
      http.get("/api/projects/p1/share", () =>
        HttpResponse.json({ ...UNPUBLISHED, allowed: false }),
      ),
    );
    renderProject(undefined, { route: "/projects/p1/settings" });

    expect(
      await screen.findByText(
        "Публичные ссылки выключены: установкой или настройкой организации",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Опубликовать" })).not.toBeInTheDocument();
  });
});
