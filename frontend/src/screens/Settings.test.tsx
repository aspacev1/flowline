import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { STATE, projectFixtures } from "../test/project";
import { server } from "../test/server";
import { ORG, USER, renderApp, sessionHandlers } from "../test/utils";

/**
 * Экраны настроек уровней 2–4.
 *
 * Проверяется то, что видно человеку: поле уходит на сервер само, занятый слаг
 * подсказывает свободный, а `null` в переопределении означает «наследовать», а
 * не «пусто».
 */

type Patch = Record<string, unknown>;

function orgFixtures(role = "owner") {
  const patches: Patch[] = [];
  let org = { ...ORG, role };
  // Без sessionHandlers(): их ставит beforeEach, а внутри одного вызова
  // `server.use` предпочтение получает обработчик, названный раньше, — и
  // общий ответ про организацию перебил бы этот.
  server.use(
    http.get("/api/org", () => HttpResponse.json(org)),
    // Блок подключения LLM живёт на этом же экране: без ответа про ключ он
    // просто не рисуется, но запрос всё равно уходит.
    http.get("/api/ai/credential", () =>
      HttpResponse.json({ provider: "openai", base_url: "", model: "", configured: false }),
    ),
    http.patch("/api/org", async ({ request }) => {
      const patch = (await request.json()) as Patch;
      patches.push(patch);
      org = { ...org, ...patch, settings: { ...org.settings, ...patch } };
      return HttpResponse.json(org);
    }),
  );
  return patches;
}

describe("настройки организации", () => {
  beforeEach(() => {
    server.use(...sessionHandlers());
  });

  it("показывает дефолты, которые наследуют проекты", async () => {
    orgFixtures();
    renderApp({ route: "/settings/organization" });

    expect(await screen.findByLabelText("Часовой пояс")).toHaveValue("Asia/Baku");
    expect(screen.getByLabelText("Порог сдвига, дней")).toHaveValue(2);
    expect(screen.getByLabelText(/Производственный календарь/)).toHaveValue("2026-03-20");
  });

  it("отправляет только изменённое поле, а не форму целиком", async () => {
    const patches = orgFixtures();
    renderApp({ route: "/settings/organization" });

    const threshold = await screen.findByLabelText("Порог сдвига, дней");
    await userEvent.clear(threshold);
    await userEvent.type(threshold, "5");
    await userEvent.tab();

    await waitFor(() => expect(patches).toEqual([{ default_shift_threshold_days: 5 }]));
  });

  it("рабочие дни отправляются маской, где нулевой бит — понедельник", async () => {
    const patches = orgFixtures();
    renderApp({ route: "/settings/organization" });

    const days = await screen.findByRole("group", { name: "Рабочие дни" });
    await userEvent.click(within(days).getByLabelText("сб"));

    // Пн–пт плюс суббота.
    await waitFor(() => expect(patches).toEqual([{ working_days: 0b111111 }]));
  });

  it("праздники приводятся к списку дат", async () => {
    const patches = orgFixtures();
    renderApp({ route: "/settings/organization" });

    const holidays = await screen.findByLabelText(/Производственный календарь/);
    await userEvent.clear(holidays);
    await userEvent.type(holidays, "2026-03-20\n2026-03-21");
    await userEvent.tab();

    await waitFor(() =>
      expect(patches).toEqual([{ holiday_calendar: ["2026-03-20", "2026-03-21"] }]),
    );
  });

  it("не отправляет ничего, пока дата написана неверно", async () => {
    const patches = orgFixtures();
    renderApp({ route: "/settings/organization" });

    const holidays = await screen.findByLabelText(/Производственный календарь/);
    await userEvent.clear(holidays);
    await userEvent.type(holidays, "20 марта");
    await userEvent.tab();

    expect(await screen.findByText(/формате ГГГГ-ММ-ДД/)).toBeInTheDocument();
    expect(patches).toEqual([]);
  });

  it("занятый слаг подсказывает свободный вариант, и его можно взять одним щелчком", async () => {
    const patches = orgFixtures();
    server.use(
      http.get("/api/org/slug-check", ({ request }) => {
        const slug = new URL(request.url).searchParams.get("slug") ?? "";
        return HttpResponse.json({
          normalized: slug,
          available: slug !== "globex",
          suggestion: slug === "globex" ? "globex-2" : slug,
        });
      }),
    );
    renderApp({ route: "/settings/organization" });

    const field = await screen.findByLabelText("Адрес (слаг)");
    await userEvent.clear(field);
    await userEvent.type(field, "globex");

    const suggestion = await screen.findByRole("button", { name: "globex-2" }, { timeout: 2000 });
    await userEvent.click(suggestion);

    await waitFor(() => expect(patches).toEqual([{ slug: "globex-2" }]));
  });

  it("редактору поля показываются, но не даются", async () => {
    orgFixtures("editor");
    renderApp({ route: "/settings/organization" });

    expect(await screen.findByLabelText("Часовой пояс")).toBeDisabled();
    expect(screen.getByText(/только владелец/)).toBeInTheDocument();
  });
});

describe("настройки проекта", () => {
  beforeEach(projectFixtures);

  function projectSettingsFixtures(overrides = {}) {
    const patches: Patch[] = [];
    let state = {
      ...STATE,
      overrides: {
        timezone: null,
        working_days: null,
        shift_threshold_days: null,
        holidays_extra: [],
        workdays_extra: [],
        ...overrides,
      },
    };
    server.use(
      http.get("/api/projects/p1", () => HttpResponse.json(state)),
      http.patch("/api/projects/p1", async ({ request }) => {
        const patch = (await request.json()) as Patch;
        patches.push(patch);
        state = { ...state, ...patch, overrides: { ...state.overrides, ...patch } };
        return HttpResponse.json(state);
      }),
    );
    return patches;
  }

  it("показывает унаследованное значение, а не подставляет его как своё", async () => {
    projectSettingsFixtures();
    renderApp({ route: "/projects/p1/settings" });

    // Порог наследуется: галочка стоит, своего поля нет вовсе.
    const inherit = await screen.findByLabelText(/Наследовать от организации \(2\)/);
    expect(inherit).toBeChecked();
    expect(screen.queryByLabelText("Порог сдвига, дней")).toBeNull();
  });

  it("снятая галочка заводит собственное значение проекта", async () => {
    const patches = projectSettingsFixtures();
    renderApp({ route: "/projects/p1/settings" });

    await userEvent.click(await screen.findByLabelText(/Наследовать от организации \(2\)/));

    await waitFor(() => expect(patches).toEqual([{ shift_threshold_days: 2 }]));
  });

  it("возврат к наследованию отправляет null, а не пустую строку", async () => {
    const patches = projectSettingsFixtures({ shift_threshold_days: 7 });
    renderApp({ route: "/projects/p1/settings" });

    const inherit = await screen.findByLabelText(/Наследовать от организации \(2\)/);
    expect(inherit).not.toBeChecked();
    await userEvent.click(inherit);

    await waitFor(() => expect(patches).toEqual([{ shift_threshold_days: null }]));
  });

  it("целевая дата снимается пустым полем", async () => {
    const patches = projectSettingsFixtures();
    renderApp({ route: "/projects/p1/settings" });

    await userEvent.clear(await screen.findByLabelText("Целевая дата"));

    await waitFor(() => expect(patches).toEqual([{ deadline: null }]));
  });
});

describe("профиль", () => {
  beforeEach(() => {
    server.use(...sessionHandlers());
  });

  it("язык сохраняется в профиль, а не только в память браузера", async () => {
    const patches: Patch[] = [];
    server.use(
      http.patch("/api/auth/me", async ({ request }) => {
        const patch = (await request.json()) as Patch;
        patches.push(patch);
        return HttpResponse.json({ ...USER, ...patch });
      }),
    );
    renderApp({ route: "/settings/profile" });

    // По роли, а не по подписи: переключатель языка в шапке подписан так же,
    // и это правильно — оба про одно и то же.
    await userEvent.selectOptions(
      await screen.findByRole("combobox", { name: "Язык интерфейса" }),
      "az",
    );

    await waitFor(() => expect(patches).toEqual([{ locale: "az" }]));
    // И интерфейс переключился сразу, не дожидаясь перезагрузки: заголовок
    // экрана теперь азербайджанский.
    expect(await screen.findByRole("heading", { name: "Profil" })).toBeInTheDocument();
  });

  it("адрес показывается, но не правится", async () => {
    renderApp({ route: "/settings/profile" });

    expect(await screen.findByText(USER.email)).toBeInTheDocument();
    expect(screen.queryByLabelText("Почта")).toBeNull();
  });
});
