import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { server } from "../test/server";
import { ORG, USER, renderApp, sessionHandlers } from "../test/utils";

const CONFIG = {
  mail_enabled: false,
  signup_mode: "open",
  supported_locales: ["az", "en", "ru"],
  default_locale: "az",
  public_sharing_enabled: true,
};

function memberFixtures(config = CONFIG) {
  const created: Record<string, unknown>[] = [];
  server.use(
    http.get("/api/config", () => HttpResponse.json(config)),
    http.get("/api/org/members", () => HttpResponse.json([{ ...USER, role: "owner" }])),
    http.get("/api/org/invitations", () => HttpResponse.json([])),
    http.post("/api/org/invitations", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      created.push(body);
      const emails = (body.emails as string[]) ?? [];
      const targets = emails.length > 0 ? emails : [null];
      return HttpResponse.json(
        targets.map((email, index) => ({
          id: `i${index}`,
          email,
          role: body.role,
          expires_at: "2026-08-18T00:00:00+00:00",
          link: `https://flowline.test/invite/tok${index}`,
          sent: config.mail_enabled,
          mail_error: null,
        })),
        { status: 201 },
      );
    }),
  );
  return created;
}

describe("приглашения", () => {
  beforeEach(() => {
    server.use(...sessionHandlers());
  });

  it("показывает ссылку сразу и говорит, что второго раза не будет", async () => {
    memberFixtures();
    renderApp({ route: "/settings/members" });

    await userEvent.type(await screen.findByLabelText("Адреса"), "maria@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Выпустить ссылку" }));

    expect(await screen.findByText("https://flowline.test/invite/tok0")).toBeInTheDocument();
    // Сервер ссылку не помнит — об этом сказано прямо, а не оставлено на
    // догадку.
    expect(screen.getByText(/сервер её не помнит/)).toBeInTheDocument();
  });

  it("без настроенной почты кнопки отправки нет вовсе", async () => {
    memberFixtures();
    renderApp({ route: "/settings/members" });

    // Установка без почтового сервера остаётся полноценной: остаётся выпуск
    // ссылки.
    expect(await screen.findByRole("button", { name: "Выпустить ссылку" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /отправить письмо/i })).toBeNull();
  });

  it("с настроенной почтой предлагает отправить письмо", async () => {
    const created = memberFixtures({ ...CONFIG, mail_enabled: true });
    renderApp({ route: "/settings/members" });

    await userEvent.type(await screen.findByLabelText("Адреса"), "maria@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Пригласить и отправить письмо" }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ emails: ["maria@example.com"], send_email: true });
  });

  it("несколько адресов уходят одним действием", async () => {
    const created = memberFixtures();
    renderApp({ route: "/settings/members" });

    await userEvent.type(
      await screen.findByLabelText("Адреса"),
      "a@example.com b@example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Выпустить ссылку" }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].emails).toEqual(["a@example.com", "b@example.com"]);
  });

  it("роль client спрашивает проекты, остальные — нет", async () => {
    memberFixtures();
    server.use(
      http.get("/api/projects", () =>
        HttpResponse.json([{ id: "p1", name: "Редизайн", slug: "redizayn" }]),
      ),
    );
    renderApp({ route: "/settings/members" });

    // У наблюдателя списка проектов нет: он и так видит все проекты
    // организации, и список обещал бы ограничение, которого нет.
    expect(screen.queryByRole("group", { name: "Проекты" })).toBeNull();

    await userEvent.selectOptions(await screen.findByLabelText("Роль"), "client");

    expect(await screen.findByRole("group", { name: "Проекты" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Редизайн")).toBeInTheDocument();
  });

  it("не владельцу экран не показывается", async () => {
    memberFixtures();
    server.use(http.get("/api/org", () => HttpResponse.json({ ...ORG, role: "editor" })));
    renderApp({ route: "/settings/members" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Для этого у вас нет прав");
  });
});

describe("приём приглашения", () => {
  beforeEach(() => {
    server.use(...sessionHandlers());
  });

  it("показывает, куда зовут, и принимает по кнопке", async () => {
    let accepted = 0;
    server.use(
      http.get("/api/invitations/tok", () =>
        HttpResponse.json({
          org_name: "Şəhər Studiyası",
          role: "viewer",
          email: USER.email,
          expires_at: "2026-08-18T00:00:00+00:00",
        }),
      ),
      http.post("/api/invitations/tok/accept", () => {
        accepted += 1;
        return HttpResponse.json({ org_id: "o2", org_name: "Şəhər Studiyası", role: "viewer" });
      }),
      http.get("/api/projects", () => HttpResponse.json([])),
    );
    renderApp({ route: "/invite/tok" });

    expect(await screen.findByRole("heading", { name: /Şəhər Studiyası/ })).toBeInTheDocument();
    expect(screen.getByText("Роль: Наблюдатель")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Принять приглашение" }));

    await waitFor(() => expect(accepted).toBe(1));
  });

  it("просроченное объясняется отдельно от отозванного", async () => {
    server.use(
      http.get("/api/invitations/tok", () =>
        HttpResponse.json({ detail: "invite_expired" }, { status: 409 }),
      ),
    );
    renderApp({ route: "/invite/tok" });

    // Три разных сообщения, а не одно «ссылка недействительна».
    expect(await screen.findByRole("alert")).toHaveTextContent(/Срок приглашения истёк/);
  });

  it("чужой аккаунт узнаётся до нажатия, а не после отказа сервера", async () => {
    server.use(
      http.get("/api/invitations/tok", () =>
        HttpResponse.json({
          org_name: "Globex",
          role: "editor",
          email: "someone@else.test",
          expires_at: "2026-08-18T00:00:00+00:00",
        }),
      ),
    );
    renderApp({ route: "/invite/tok" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/someone@else.test/);
    expect(screen.queryByRole("button", { name: "Принять приглашение" })).toBeNull();
  });
});
