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

const UNPUBLISHED = { allowed: true, url: null, comments_enabled: true, created_at: null };

async function openDialog() {
  // Кнопка появляется вместе с экраном проекта, то есть после ответа
  // сервера: искать её сразу — значит проверять скорость сети.
  await userEvent.click(await screen.findByRole("button", { name: "Поделиться" }));
}

describe("публичная ссылка проекта", () => {
  beforeEach(() => projectFixtures());

  it("публикует проект и показывает адрес, собранный сервером", async () => {
    let published = false;
    server.use(
      http.get("/api/projects/p1/share", () =>
        HttpResponse.json(published ? PUBLISHED : UNPUBLISHED),
      ),
      http.post("/api/projects/p1/share", () => {
        published = true;
        return HttpResponse.json(PUBLISHED, { status: 201 });
      }),
    );

    renderProject();
    await openDialog();

    await userEvent.click(await screen.findByRole("button", { name: "Опубликовать" }));

    // Адрес приходит с сервера целиком: домен установки знает только он.
    expect(await screen.findByLabelText("Адрес ссылки")).toHaveValue(URL);
  });

  it("предупреждает, что перевыпуск убивает прежний адрес", async () => {
    server.use(http.get("/api/projects/p1/share", () => HttpResponse.json(PUBLISHED)));

    renderProject();
    await openDialog();

    expect(
      await screen.findByText(
        "Новая ссылка мгновенно убивает прежнюю — уже отправленный адрес перестанет открываться",
      ),
    ).toBeInTheDocument();
  });

  it("переключатель комментариев уходит на сервер и адрес не меняется", async () => {
    const sent: Array<Record<string, unknown>> = [];
    server.use(
      http.get("/api/projects/p1/share", () =>
        HttpResponse.json(
          sent.length === 0 ? PUBLISHED : { ...PUBLISHED, comments_enabled: false },
        ),
      ),
      http.patch("/api/projects/p1/share", async ({ request }) => {
        sent.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ ...PUBLISHED, comments_enabled: false });
      }),
    );

    renderProject();
    await openDialog();

    await userEvent.click(await screen.findByLabelText("Разрешить комментарии"));

    await waitFor(() => expect(sent).toEqual([{ comments_enabled: false }]));
    expect(screen.getByLabelText("Адрес ссылки")).toHaveValue(URL);
  });

  it("закрывает ссылку и возвращает проект в неопубликованное состояние", async () => {
    let revoked = false;
    server.use(
      http.get("/api/projects/p1/share", () =>
        HttpResponse.json(revoked ? UNPUBLISHED : PUBLISHED),
      ),
      http.delete("/api/projects/p1/share", () => {
        revoked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderProject();
    await openDialog();

    await userEvent.click(await screen.findByRole("button", { name: "Закрыть ссылку" }));

    expect(await screen.findByRole("button", { name: "Опубликовать" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Адрес ссылки")).not.toBeInTheDocument();
  });

  it("в закрытой установке не предлагает публикацию вовсе", async () => {
    server.use(
      http.get("/api/projects/p1/share", () =>
        HttpResponse.json({ ...UNPUBLISHED, allowed: false }),
      ),
    );

    renderProject();
    await openDialog();

    // Кнопка, которая кончится отказом, — хуже её отсутствия: причина
    // названа словами.
    expect(
      await screen.findByText(
        "Публичные ссылки выключены: установкой или настройкой организации",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Опубликовать" })).not.toBeInTheDocument();
  });

  it("читателю кнопки публикации не показывают", async () => {
    renderProject(undefined, { canWrite: false });

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Поделиться" })).not.toBeInTheDocument();
  });

  it("перевыпуск идёт отдельным вызовом, а не повторным созданием", async () => {
    const calls: string[] = [];
    server.use(
      http.get("/api/projects/p1/share", () => HttpResponse.json(PUBLISHED)),
      http.post("/api/projects/p1/share/rotate", () => {
        calls.push("rotate");
        return HttpResponse.json(PUBLISHED);
      }),
      // Повторное создание сервер встречает отказом: сюда перевыпуск ходить
      // не должен вовсе.
      http.post("/api/projects/p1/share", () => {
        calls.push("issue");
        return new HttpResponse(null, { status: 409 });
      }),
    );

    renderProject();
    await openDialog();

    await userEvent.click(await screen.findByRole("button", { name: "Перевыпустить" }));

    await waitFor(() => expect(calls).toEqual(["rotate"]));
  });
});

/**
 * Настройки проекта показывают то же тело, что и окно. Раньше это были два
 * компонента, и настройки отстали: без «Копировать», без проверки `allowed` и
 * с перевыпуском через повторное создание. Тесты идут через настройки, потому
 * что расходится всегда именно эта, вторая точка входа.
 */
describe("та же ссылка из настроек проекта", () => {
  beforeEach(() => projectFixtures());

  function renderSettings() {
    return renderProject(undefined, { route: "/projects/p1/settings" });
  }

  it("даёт скопировать адрес и перевыпускает отдельным вызовом", async () => {
    const calls: string[] = [];
    server.use(
      http.get("/api/projects/p1/share", () => HttpResponse.json(PUBLISHED)),
      http.post("/api/projects/p1/share/rotate", () => {
        calls.push("rotate");
        return HttpResponse.json(PUBLISHED);
      }),
      http.post("/api/projects/p1/share", () => {
        calls.push("issue");
        return new HttpResponse(null, { status: 409 });
      }),
    );

    renderSettings();

    expect(await screen.findByLabelText("Адрес ссылки")).toHaveValue(URL);
    expect(screen.getByRole("button", { name: "Скопировать" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Перевыпустить" }));

    await waitFor(() => expect(calls).toEqual(["rotate"]));
  });

  it("в закрытой установке не предлагает публикацию", async () => {
    server.use(
      http.get("/api/projects/p1/share", () =>
        HttpResponse.json({ ...UNPUBLISHED, allowed: false }),
      ),
    );

    renderSettings();

    expect(
      await screen.findByText(
        "Публичные ссылки выключены: установкой или настройкой организации",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Опубликовать" })).not.toBeInTheDocument();
  });
});
