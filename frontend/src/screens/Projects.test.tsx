import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import { ORG, USER, renderApp, sessionHandlers } from "../test/utils";

/** Открыть окно, набрать название, отправить. */
async function createProjectNamed(name: string) {
  await userEvent.click(await screen.findByRole("button", { name: /создать проект/i }));
  await userEvent.type(screen.getByLabelText(/название/i), name);
  await userEvent.click(screen.getByRole("button", { name: /^создать$/i }));
}

describe("экран проектов", () => {
  it("переводит интерфейс, но не данные", async () => {
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects", () =>
        HttpResponse.json([{ id: "p1", name: "Şəhər Layihəsi", slug: "seher-layihesi" }]),
      ),
    );

    renderApp({ route: "/projects", locale: "ru" });

    // Заголовок, а не любой текст: слово «Проекты» есть и в колонке.
    expect(await screen.findByRole("heading", { name: "Проекты" })).toBeInTheDocument();
    // А название проекта осталось азербайджанским на русском интерфейсе: это
    // содержимое пользователя, и переводится интерфейс, а не данные. Сам
    // переключатель языка живёт теперь на экране профиля — там он и проверен.
    expect(await screen.findByText("Şəhər Layihəsi")).toBeInTheDocument();
  });

  it("пустой список объясняет, что делать дальше", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/projects", locale: "ru" });

    expect(await screen.findByText(/пока ни одного проекта/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /создать проект/i })).toBeInTheDocument();
  });

  it("отказ сервера объясняется словами, а не пустым экраном", async () => {
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects", () =>
        HttpResponse.json({ detail: "no_organization" }, { status: 403 }),
      ),
    );

    renderApp({ route: "/projects", locale: "ru" });

    expect(await screen.findByText(/не состоите ни в одной организации/i)).toBeInTheDocument();
  });

  it("создаёт проект и уводит на него", async () => {
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects", () => HttpResponse.json([])),
      http.post("/api/projects", async ({ request }) => {
        expect(await request.json()).toEqual({ name: "Редизайн сайта" });
        return HttpResponse.json(
          { id: "p1", name: "Редизайн сайта", slug: "redizayn-sayta" },
          { status: 201 },
        );
      }),
      // Экран проекта — цель перехода; здесь он нужен лишь как адрес, куда
      // приложение обязано привести.
      http.get("/api/projects/p1", () =>
        HttpResponse.json({
          id: "p1",
          name: "Редизайн сайта",
          slug: "redizayn-sayta",
          deadline: null,
          project_end: null,
          calendar: { working_days: 31, holidays: [], extra_workdays: [] },
          settings: { shift_threshold_days: 2, timezone: "Asia/Baku" },
          categories: [],
          tasks: [],
          dependencies: [],
        }),
      ),
    );

    renderApp({ route: "/projects", locale: "ru" });
    await createProjectNamed("Редизайн сайта");

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1"),
    );
  });

  it("показывает слаг, который сервер выдал, а не выдуманный клиентом", async () => {
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects", () =>
        HttpResponse.json([{ id: "p1", name: "Şəhər Layihəsi", slug: "seher-layihesi" }]),
      ),
    );

    renderApp({ route: "/projects", locale: "ru" });

    expect(await screen.findByText("seher-layihesi")).toBeInTheDocument();
  });

  it("не даёт отправить пустое название", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/projects", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /создать проект/i }));

    expect(screen.getByRole("button", { name: /^создать$/i })).toBeDisabled();
  });

  it("объясняет отказ сервера переведённым текстом", async () => {
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects", () => HttpResponse.json([])),
      http.post("/api/projects", () => HttpResponse.json({ detail: "forbidden" }, { status: 403 })),
    );

    renderApp({ route: "/projects", locale: "ru" });
    await createProjectNamed("Тест");

    // Текст берётся из словаря по коду `forbidden`. Сам код наружу не выходит.
    expect(await screen.findByText(/у вас нет прав/i)).toBeInTheDocument();
    expect(screen.queryByText("forbidden")).not.toBeInTheDocument();
  });
});

describe("модальное окно", () => {
  it("закрывается по Esc и возвращает фокус туда, откуда открылось", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/projects", locale: "ru" });
    const opener = await screen.findByRole("button", { name: /создать проект/i });
    await userEvent.click(opener);

    // Фокус при открытии стоит на первом поле: иначе человек с клавиатуры
    // оказывается неизвестно где и обязан искать поле табуляцией.
    expect(screen.getByLabelText(/название/i)).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("закрывается кликом вне окна", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/projects", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /создать проект/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("modal-backdrop"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("с введённым в форме спрашивает, прежде чем закрыться по Esc", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/projects", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /создать проект/i }));
    await userEvent.type(screen.getByLabelText(/название/i), "Редизайн");

    await userEvent.keyboard("{Escape}");

    // Окно на месте, набранное в нём — тоже.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/название/i)).toHaveValue("Редизайн");
    expect(screen.getByText(/введённое не сохранится/i)).toBeInTheDocument();
  });

  it("«продолжить» возвращает к форме, а второй Esc её не теряет", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/projects", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /создать проект/i }));
    await userEvent.type(screen.getByLabelText(/название/i), "Редизайн");
    await userEvent.keyboard("{Escape}");

    // Esc поверх вопроса — ответ «продолжить»: привычные два Esc подряд не
    // должны приводить ровно к той потере, ради которой вопрос и задан.
    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText(/введённое не сохранится/i)).not.toBeInTheDocument();
    // Фокус вернулся туда, где человека прервали.
    expect(screen.getByLabelText(/название/i)).toHaveFocus();
  });

  it("закрывает окно, когда потерю введённого подтвердили", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/projects", locale: "ru" });
    const opener = await screen.findByRole("button", { name: /создать проект/i });
    await userEvent.click(opener);
    await userEvent.type(screen.getByLabelText(/название/i), "Редизайн");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: /закрыть без сохранения/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("с введённым в форме не закрывается от клика мимо окна", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/projects", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /создать проект/i }));
    await userEvent.type(screen.getByLabelText(/название/i), "Редизайн");

    // Промах мимо селекта на два десятка пикселей — это тот же клик по фону.
    await userEvent.click(screen.getByTestId("modal-backdrop"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/название/i)).toHaveValue("Редизайн");
  });

  it("«Отмена» самой формы закрывает окно без вопроса", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/projects", locale: "ru" });
    await userEvent.click(await screen.findByRole("button", { name: /создать проект/i }));
    await userEvent.type(screen.getByLabelText(/название/i), "Редизайн");

    // До кнопки целятся, а по фону промахиваются: спрашивать здесь значило бы
    // требовать два подтверждения на одно осознанное действие.
    await userEvent.click(screen.getByRole("button", { name: /отмена/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("данные организации", () => {
  it("название организации приходит с сервера и не переводится", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/projects", locale: "ru" });

    expect(await screen.findByText(ORG.name)).toBeInTheDocument();
    // Имя вошедшего колонка больше не показывает: приветствие убрано, и
    // верхний блок держит только организацию.
    expect(screen.queryByText(new RegExp(USER.name))).toBeNull();
  });
});
