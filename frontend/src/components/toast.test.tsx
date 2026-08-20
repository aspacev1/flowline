import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { STATE, projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";
import { ORG, USER, renderApp, sessionHandlers } from "../test/utils";
import { ToastProvider, useToast } from "./toast";

/**
 * Тост как общее правило, а не как особенность перетаскивания.
 *
 * Каждый случай здесь — операция, после которой на экране не остаётся другого
 * признака успеха: список проектов выглядит одинаково до и после удаления,
 * поле настроек — до и после записи, панель ссылки — до публикации и после
 * отзыва. Проверяется поэтому именно текст подтверждения: он и есть
 * единственный ответ системы на жест.
 *
 * Файл общий на все экраны намеренно. Правило одно, и разложенное по шести
 * файлам оно перестаёт читаться правилом — новый экран заводят, ни разу не
 * встретив его.
 */

const UNPUBLISHED = { allowed: true, url: null, comments_enabled: true, created_at: null };
const PUBLISHED = {
  allowed: true,
  url: "https://planora.example.com/p/o/redizayn?s=t0ken",
  comments_enabled: true,
  created_at: "2026-03-05T10:00:00+00:00",
};

/**
 * Сам тост, а не любой `role="status"`: этой же ролью помечены индикаторы
 * загрузки, и на экране, который только что перезапросил данные, их двое.
 */
function toast(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".toast");
  if (node === null) throw new Error("тоста на экране нет");
  return node;
}

describe("подтверждения тихих операций", () => {
  beforeEach(projectFixtures);
  beforeEach(() => {
    server.use(http.get("/api/projects/p1/share", () => HttpResponse.json(UNPUBLISHED)));
  });

  it("удаление проекта названо словами: список сам по себе ни о чём не отчитывается", async () => {
    server.use(
      http.get("/api/projects", () => HttpResponse.json([])),
      http.delete("/api/projects/p1", () => new HttpResponse(null, { status: 204 })),
    );
    renderProject(undefined, { route: "/projects/p1/settings" });

    await userEvent.click(await screen.findByRole("button", { name: "Удалить проект" }));
    await userEvent.click(screen.getByRole("button", { name: "Да, удалить проект" }));

    // Название — из удалённого проекта: к этому моменту его нет уже ни на
    // сервере, ни в кэше, и взять его тосту неоткуда, кроме как из жеста.
    expect(await screen.findByText("Проект «Редизайн» удалён")).toBeInTheDocument();
    // Отменить удаление нельзя, и предлагать это тост не должен: журнал
    // ревизий ушёл вместе с проектом.
    expect(within(toast()).queryByRole("button")).toBeNull();
  });

  // Это подтверждение — единственное здесь, которое тостом не показывается:
  // полей на экране десяток, и о записи каждого отчитывается оно само,
  // отметкой рядом (см. SaveMark). Тост назвал бы «сохранено», не назвав что.
  it("поле настроек проекта, ушедшее по потере фокуса, подтверждается у поля", async () => {
    server.use(
      http.patch("/api/projects/p1", async ({ request }) => {
        const patch = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...STATE, ...patch });
      }),
    );
    renderProject(undefined, { route: "/projects/p1/settings" });

    const name = await screen.findByLabelText("Название");
    await userEvent.clear(name);
    await userEvent.type(name, "Редизайн сайта");
    await userEvent.tab();

    // Отметка у поля, а не плашка внизу экрана: класс отличает одно от другого,
    // а `role="status"` носят оба — и говорят они об одном и том же.
    expect(await screen.findByText("Сохранено")).toHaveClass("field__mark");
    expect(screen.queryByRole("status")).not.toHaveClass("toast");
  });

  it("отзыв публичной ссылки подтверждается: панель после него выглядит как до публикации", async () => {
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
    renderProject(undefined, { route: "/projects/p1/settings" });

    await userEvent.click(await screen.findByRole("button", { name: "Закрыть ссылку" }));
    // Кнопка сперва спрашивает: отзыв гасит уже разосланный адрес.
    await userEvent.click(screen.getByRole("button", { name: "Да, закрыть ссылку" }));

    expect(await screen.findByText("Публичная ссылка закрыта")).toBeInTheDocument();
  });
});

describe("подтверждения на экранах организации", () => {
  beforeEach(() => {
    server.use(...sessionHandlers());
  });

  it("созданный проект назван в тосте: пустая диаграмма похожа и на промах мимо кнопки", async () => {
    server.use(
      http.get("/api/projects", () => HttpResponse.json([])),
      http.post("/api/projects", () =>
        HttpResponse.json({ id: "p1", name: "Редизайн сайта", slug: "redizayn" }, { status: 201 }),
      ),
      http.get("/api/projects/p1", () =>
        HttpResponse.json({ ...STATE, id: "p1", name: "Редизайн сайта" }),
      ),
      http.get("/api/projects/p1/revisions", () => HttpResponse.json([])),
      http.get("/api/projects/p1/share", () => HttpResponse.json(UNPUBLISHED)),
    );
    renderApp({ route: "/projects", locale: "ru" });

    await userEvent.click(await screen.findByRole("button", { name: /создать проект/i }));
    await userEvent.type(screen.getByLabelText(/название/i), "Редизайн сайта");
    await userEvent.click(screen.getByRole("button", { name: /^создать$/i }));

    // Тост переживает переход на экран проекта: он висит на раме приложения,
    // а не на экране, с которого ушли.
    expect(await screen.findByText("Проект «Редизайн сайта» создан")).toBeInTheDocument();
  });

  it("отзыв приглашения подтверждается: на экране от него меняются два слова", async () => {
    const PENDING = {
      id: "i1",
      email: "guest@example.com",
      role: "viewer",
      status: "pending",
      project_ids: [],
      created_at: "2026-08-11T09:00:00+00:00",
      expires_at: "2026-08-18T09:00:00+00:00",
      last_sent_at: null,
      invited_by: "Алексей",
      accepted_at: null,
    };
    let revoked = false;
    server.use(
      http.get("/api/org/members", () => HttpResponse.json([USER])),
      http.get("/api/org/invitations", () =>
        HttpResponse.json({
          mail_enabled: false,
          invitations: [{ ...PENDING, status: revoked ? "revoked" : "pending" }],
        }),
      ),
      http.delete("/api/org/invitations/i1", () => {
        revoked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp({ route: "/settings/members", locale: "ru" });

    await userEvent.click(await screen.findByRole("button", { name: "Отозвать" }));
    await userEvent.click(screen.getByRole("button", { name: "Да, отозвать" }));

    expect(await screen.findByText("Приглашение отозвано")).toBeInTheDocument();
  });

  it("правка профиля по потере фокуса подтверждается у поля", async () => {
    renderApp({ route: "/settings/profile", locale: "ru" });

    const name = await screen.findByLabelText("Имя");
    await userEvent.clear(name);
    await userEvent.type(name, "Алексей Петров");
    await userEvent.tab();

    expect(await screen.findByText("Сохранено")).toHaveClass("field__mark");
  });

  it("настройка организации по потере фокуса подтверждается у поля", async () => {
    server.use(
      http.get("/api/ai/credential", () =>
        HttpResponse.json({ provider: "openai", base_url: "", model: "", configured: false }),
      ),
      http.get("/api/jira/credential", () =>
        HttpResponse.json({ base_url: "", email: "", configured: false }),
      ),
      http.patch("/api/org", async ({ request }) => {
        const patch = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...ORG, ...patch });
      }),
    );
    renderApp({ route: "/settings/organization", locale: "ru" });

    const zone = await screen.findByLabelText("Часовой пояс");
    await userEvent.clear(zone);
    await userEvent.type(zone, "Europe/Moscow");
    await userEvent.tab();

    expect(await screen.findByText("Сохранено")).toHaveClass("field__mark");
  });
});

describe("тон тоста", () => {
  beforeEach(projectFixtures);

  it("отказ не носит галочку подтверждения и объявляется как тревога", async () => {
    // Отмена переноса из тоста — единственное место, где тост показывает
    // отказ: строки ошибки рядом с лентой нет.
    server.use(
      http.post("/api/projects/p1/undo", () =>
        HttpResponse.json({ detail: "task_not_found" }, { status: 404 }),
      ),
    );

    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });
    bar.focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");

    await userEvent.click(await screen.findByRole("button", { name: "Отменить" }));

    // Тревога, а не сводка: читалка обязана объявить отказ сразу.
    const failure = await screen.findByRole("alert");
    expect(failure).toHaveClass("toast--error");
    expect(failure).not.toHaveTextContent("✓");
  });

  it("подтверждение остаётся сводкой и галочку носит", async () => {
    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });
    bar.focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");

    await waitFor(() => expect(toast()).toHaveTextContent("✓"));
    expect(toast()).not.toHaveClass("toast--error");
  });
});

/** Две кнопки, каждая со своим тостом: смену тоста иначе не воспроизвести. */
function Harness() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast({ message: "Задача перенесена" })}>
        Первый
      </button>
      <button type="button" onClick={() => toast({ message: "Задача возвращена" })}>
        Второй
      </button>
    </>
  );
}

describe("тост", () => {
  it("появляется заново, когда один тост сменяет другой", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Первый" }));
    const first = screen.getByRole("status");

    await user.click(screen.getByRole("button", { name: "Второй" }));
    const second = screen.getByRole("status");

    expect(second).toHaveTextContent("Задача возвращена");
    // Узел именно новый, а не переписанный: появление тоста нарисовано
    // анимацией, а она играет один раз на узел — сменив только текст, второй
    // тост возник бы срезом там, где первый выехал.
    expect(second).not.toBe(first);
  });
});
