import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { renderApp } from "../test/utils";
import { projectFixtures } from "../test/project";
import { server } from "../test/server";

type Share = { published: boolean; comments_enabled: boolean };

const SETTINGS = {
  slug: "redizayn",
  public_url: "https://flowline.example.com/p/seher-studiyasi/redizayn",
  public_sharing_enabled: true,
  share: { published: false, comments_enabled: true },
};

function settingsFixtures(overrides: Partial<typeof SETTINGS> = {}) {
  const sent: Share[] = [];
  let state = { ...SETTINGS, ...overrides };

  server.use(
    http.get("/api/projects/p1/settings", () => HttpResponse.json(state)),
    http.put("/api/projects/p1/share", async ({ request }) => {
      const share = (await request.json()) as Share;
      sent.push(share);
      state = { ...state, share };
      return HttpResponse.json(share);
    }),
    http.get("/api/projects/p1/slug-check", ({ request }) => {
      const slug = new URL(request.url).searchParams.get("slug") ?? "";
      const taken = slug === "zanyato";
      return HttpResponse.json({
        available: !taken,
        suggestion: taken ? `${slug}-a1b2c3` : slug,
      });
    }),
    http.put("/api/projects/p1/slug", async ({ request }) => {
      const { slug } = (await request.json()) as { slug: string };
      if (slug === "zanyato") {
        return HttpResponse.json({ detail: "slug_taken" }, { status: 422 });
      }
      state = {
        ...state,
        slug,
        public_url: `https://flowline.example.com/p/seher-studiyasi/${slug}`,
      };
      return HttpResponse.json({ slug, public_url: state.public_url });
    }),
  );

  return sent;
}

function open() {
  return renderApp({ route: "/projects/p1/settings", locale: "ru" });
}

describe("настройки проекта", () => {
  beforeEach(() => {
    projectFixtures();
  });

  it("показывает адрес ещё до публикации", async () => {
    settingsFixtures();
    open();

    // Адрес выведен из слагов, а не выдан публикацией: владелец должен
    // видеть, что именно он собирается открыть.
    expect(await screen.findByDisplayValue(/\/p\/seher-studiyasi\/redizayn$/)).toBeInTheDocument();
  });

  it("публикует проект одним переключателем", async () => {
    const sent = settingsFixtures();
    open();

    await userEvent.click(await screen.findByRole("switch", { name: /Публичная ссылка/i }));

    await waitFor(() => expect(sent).toEqual([{ published: true, comments_enabled: true }]));
  });

  it("шлёт положение обоих переключателей разом", async () => {
    const sent = settingsFixtures({ share: { published: true, comments_enabled: true } });
    open();

    await userEvent.click(await screen.findByRole("switch", { name: /Комментарии/i }));

    await waitFor(() => expect(sent).toEqual([{ published: true, comments_enabled: false }]));
  });

  it("не даёт трогать комментарии, пока проект не опубликован", async () => {
    settingsFixtures();
    open();

    expect(await screen.findByRole("switch", { name: /Комментарии/i })).toBeDisabled();
  });

  it("объясняет, что публикация запрещена организацией", async () => {
    settingsFixtures({ public_sharing_enabled: false });
    open();

    expect(await screen.findByRole("switch", { name: /Публичная ссылка/i })).toBeDisabled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/организац/i);
  });

  it("подсказывает свободный слаг прямо в поле", async () => {
    settingsFixtures();
    open();

    const field = await screen.findByLabelText(/Адрес в ссылке/i);
    await userEvent.clear(field);
    await userEvent.type(field, "zanyato");

    expect(await screen.findByText(/zanyato-a1b2c3/)).toBeInTheDocument();
  });

  it("переименование слага меняет показанный адрес", async () => {
    settingsFixtures();
    open();

    const field = await screen.findByLabelText(/Адрес в ссылке/i);
    await userEvent.clear(field);
    await userEvent.type(field, "redizayn-2027");
    await userEvent.click(screen.getByRole("button", { name: /Сохранить адрес/i }));

    expect(
      await screen.findByDisplayValue(/\/p\/seher-studiyasi\/redizayn-2027$/),
    ).toBeInTheDocument();
  });

  it("предупреждает, что переименование убивает прежний адрес", async () => {
    settingsFixtures();
    open();

    // Человек обязан узнать об этом до нажатия, а не от клиента, у которого
    // перестала открываться ссылка.
    const section = await screen.findByRole("region", { name: /Адрес/i });
    expect(within(section).getByText(/прежний адрес/i)).toBeInTheDocument();
  });

  it("объясняет отказ сервера словами", async () => {
    settingsFixtures();
    server.use(
      http.put("/api/projects/p1/share", () =>
        HttpResponse.json({ detail: "public_sharing_disabled" }, { status: 422 }),
      ),
    );
    open();

    await userEvent.click(await screen.findByRole("switch", { name: /Публичная ссылка/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/организац/i);
  });
});
