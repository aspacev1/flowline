import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "../test/server";
import { ORG, renderApp, sessionHandlers } from "../test/utils";

const ROSTER = [
  { id: "u1", name: "Алексей", email: "a@b.c", role: "owner" },
  { id: "u2", name: "Мария", email: "m@b.c", role: "editor" },
];

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

function membersHandlers(
  options: { mailEnabled?: boolean; invitations?: unknown[]; role?: string } = {},
) {
  const { mailEnabled = false, invitations = [PENDING], role = "owner" } = options;
  // Свои ответы идут первыми: msw берёт первый подходящий обработчик, и
  // общий `/api/org` из sessionHandlers перекрыл бы роль, заданную тестом.
  return [
    http.get("/api/org", () => HttpResponse.json({ ...ORG, role })),
    http.get("/api/org/members", () => HttpResponse.json(ROSTER)),
    http.get("/api/org/invitations", () =>
      HttpResponse.json({ mail_enabled: mailEnabled, invitations }),
    ),
    ...sessionHandlers(),
  ];
}

describe("экран участников", () => {
  it("показывает состав организации с ролями", async () => {
    server.use(...membersHandlers());

    renderApp({ route: "/members", locale: "ru" });

    expect(await screen.findByText("Мария")).toBeInTheDocument();
    expect(screen.getByText("Редактор")).toBeInTheDocument();
  });

  it("выпущенная ссылка показывается сразу и с предупреждением, что второй раз её не будет", async () => {
    server.use(
      ...membersHandlers({ invitations: [] }),
      http.post("/api/org/invitations", () =>
        HttpResponse.json(
          [
            {
              id: "i2",
              email: "guest@example.com",
              role: "viewer",
              expires_at: "2026-08-18T09:00:00+00:00",
              url: "http://localhost:8000/invite/секретный-токен",
              sent: false,
              mail_error: null,
            },
          ],
          { status: 201 },
        ),
      ),
    );

    renderApp({ route: "/members", locale: "ru" });

    await userEvent.click(await screen.findByRole("button", { name: /пригласить/i }));
    await userEvent.type(screen.getByLabelText(/адреса/i), "guest@example.com");
    await userEvent.click(screen.getByRole("button", { name: /создать приглашение/i }));

    const link = await screen.findByLabelText(/ссылка приглашения/i);
    expect(link).toHaveValue("http://localhost:8000/invite/секретный-токен");
    expect(screen.getByText(/второй раз её взять негде/i)).toBeInTheDocument();
  });

  it("без настроенной почты кнопки отправки нет вовсе", async () => {
    server.use(...membersHandlers({ mailEnabled: false }));

    renderApp({ route: "/members", locale: "ru" });

    expect(await screen.findByRole("button", { name: /новая ссылка/i })).toBeInTheDocument();
    // Установка без почтового сервера остаётся полноценной: остаётся
    // копирование ссылки, а кнопки, которая всегда ответит отказом, нет.
    expect(screen.queryByRole("button", { name: /отправить ещё раз/i })).not.toBeInTheDocument();
  });

  it("с настроенной почтой отправить приглашение можно ещё раз", async () => {
    server.use(...membersHandlers({ mailEnabled: true }));

    renderApp({ route: "/members", locale: "ru" });

    expect(await screen.findByRole("button", { name: /отправить ещё раз/i })).toBeInTheDocument();
  });

  it("повторный выпуск спрашивает и показывает новую ссылку", async () => {
    let reissued = false;
    server.use(
      ...membersHandlers(),
      http.post("/api/org/invitations/i1/reissue", () => {
        reissued = true;
        return HttpResponse.json({
          id: "i1",
          email: "guest@example.com",
          role: "viewer",
          expires_at: "2026-08-18T09:00:00+00:00",
          url: "http://localhost:8000/invite/новый-токен",
          sent: false,
          mail_error: null,
        });
      }),
    );

    renderApp({ route: "/members", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /^новая ссылка$/i }));

    // Прежняя ссылка живёт до ответа на вопрос: перевыпуск убивает её, а
    // «новая ссылка» об этом не говорит ни словом.
    expect(reissued).toBe(false);
    expect(screen.getByText(/прежняя ссылка умрёт сразу/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /да, новая ссылка/i }));

    expect(await screen.findByLabelText(/ссылка приглашения/i)).toHaveValue(
      "http://localhost:8000/invite/новый-токен",
    );
  });

  it("отзыв приглашения тоже спрашивает, и от него можно отказаться", async () => {
    let revoked = false;
    server.use(
      ...membersHandlers(),
      http.delete("/api/org/invitations/i1", () => {
        revoked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApp({ route: "/members", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /^отозвать$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^отмена$/i }));

    expect(revoked).toBe(false);
    expect(screen.getByRole("button", { name: /^отозвать$/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^отозвать$/i }));
    await userEvent.click(screen.getByRole("button", { name: /да, отозвать/i }));

    await waitFor(() => expect(revoked).toBe(true));
  });

  it("«отправить ещё раз» предупреждает тем же: это тот же перевыпуск", async () => {
    server.use(...membersHandlers({ mailEnabled: true }));

    renderApp({ route: "/members", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /отправить ещё раз/i }));

    expect(screen.getByText(/прежняя ссылка умрёт сразу/i)).toBeInTheDocument();
  });

  it("письмо, которое не ушло, названо прямо, а приглашение остаётся", async () => {
    server.use(
      ...membersHandlers({ invitations: [] }),
      http.post("/api/org/invitations", () =>
        HttpResponse.json(
          [
            {
              id: "i3",
              email: "guest@example.com",
              role: "viewer",
              expires_at: "2026-08-18T09:00:00+00:00",
              url: "http://localhost:8000/invite/токен",
              sent: false,
              mail_error: "mail_failed",
            },
          ],
          { status: 201 },
        ),
      ),
    );

    renderApp({ route: "/members", locale: "ru" });

    await userEvent.click(await screen.findByRole("button", { name: /пригласить/i }));
    await userEvent.type(screen.getByLabelText(/адреса/i), "guest@example.com");
    await userEvent.click(screen.getByRole("button", { name: /создать приглашение/i }));

    expect(await screen.findByText(/письмо не ушло/i)).toBeInTheDocument();
    // Действие не откатывается: ссылка на месте и её можно отправить руками.
    expect(screen.getByLabelText(/ссылка приглашения/i)).toBeInTheDocument();
  });

  it("отозванное приглашение действий больше не предлагает", async () => {
    server.use(...membersHandlers({ invitations: [{ ...PENDING, status: "revoked" }] }));

    renderApp({ route: "/members", locale: "ru" });

    expect(await screen.findByText("Отозвано")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /отозвать/i })).not.toBeInTheDocument();
  });

  it("исчерпанный часовой потолок объясняется словами", async () => {
    server.use(
      ...membersHandlers({ invitations: [] }),
      http.post("/api/org/invitations", () =>
        HttpResponse.json({ detail: "invite_rate_limited" }, { status: 429 }),
      ),
    );

    renderApp({ route: "/members", locale: "ru" });

    await userEvent.click(await screen.findByRole("button", { name: /пригласить/i }));
    await userEvent.type(screen.getByLabelText(/адреса/i), "guest@example.com");
    await userEvent.click(screen.getByRole("button", { name: /создать приглашение/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/слишком много приглашений/i);
  });

  it("проекты выбираются только для роли «Клиент»", async () => {
    server.use(
      ...membersHandlers({ invitations: [] }),
      http.get("/api/projects", () =>
        HttpResponse.json([{ id: "p1", name: "Şəhər Layihəsi", slug: "seher-layihesi" }]),
      ),
    );

    renderApp({ route: "/members", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /пригласить/i }));

    expect(screen.queryByText("Şəhər Layihəsi")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/роль/i), "client");

    expect(await screen.findByLabelText("Şəhər Layihəsi")).toBeInTheDocument();
  });

  it("не владельцу приглашения не показываются вовсе", async () => {
    server.use(...membersHandlers({ role: "editor" }));

    renderApp({ route: "/members", locale: "ru" });

    expect(await screen.findByText("Мария")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /пригласить/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Приглашения")).not.toBeInTheDocument();
  });

  it("ссылка кладётся в буфер обмена по кнопке", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    server.use(
      ...membersHandlers(),
      http.post("/api/org/invitations/i1/reissue", () =>
        HttpResponse.json({
          id: "i1",
          email: "guest@example.com",
          role: "viewer",
          expires_at: "2026-08-18T09:00:00+00:00",
          url: "http://localhost:8000/invite/токен",
          sent: false,
          mail_error: null,
        }),
      ),
    );

    renderApp({ route: "/members", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /^новая ссылка$/i }));
    await userEvent.click(screen.getByRole("button", { name: /да, новая ссылка/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^скопировать$/i }));

    expect(writeText).toHaveBeenCalledWith("http://localhost:8000/invite/токен");
    vi.unstubAllGlobals();
  });
});

describe("переключатель организаций", () => {
  it("не показывается, пока организация одна", async () => {
    server.use(http.get("/api/org/list", () => HttpResponse.json([ORG])), ...membersHandlers());

    renderApp({ route: "/members", locale: "ru" });

    expect(await screen.findByText("Мария")).toBeInTheDocument();
    expect(screen.queryByLabelText("Организация")).not.toBeInTheDocument();
  });

  it("переключает организацию и перезапрашивает всё, что от неё зависит", async () => {
    const other = { ...ORG, id: "o2", name: "Globex", slug: "globex", role: "viewer" };
    let current = ORG;
    server.use(
      http.get("/api/org", () => HttpResponse.json(current)),
      http.get("/api/org/list", () => HttpResponse.json([ORG, other])),
      http.post("/api/org/switch", () => {
        current = other;
        return HttpResponse.json(other);
      }),
      http.get("/api/org/members", () =>
        HttpResponse.json(
          current.id === ORG.id ? ROSTER : [{ ...ROSTER[1], name: "Кто-то ещё" }],
        ),
      ),
      ...membersHandlers(),
    );

    renderApp({ route: "/members", locale: "ru" });

    const switcher = await screen.findByLabelText("Организация");
    expect(await screen.findByText("Мария")).toBeInTheDocument();

    await userEvent.selectOptions(switcher, "o2");

    // Состав организации — из новой, а не из прежней: экран следует за
    // выбором, а не остаётся на данных, которых в этой организации нет.
    expect(await screen.findByText("Кто-то ещё")).toBeInTheDocument();
    expect(switcher).toHaveValue("o2");
  });
});
