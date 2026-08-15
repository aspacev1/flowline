import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import { renderApp, sessionHandlers } from "../test/utils";

describe("портфель", () => {
  it("называется своим именем, а не «Проектами»", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/portfolio", locale: "ru" });

    // Заголовок, а не любой текст: слово «Портфель» есть и в боковой колонке.
    expect(await screen.findByRole("heading", { name: "Портфель" })).toBeInTheDocument();
    // Второго экрана с заголовком «Проекты» здесь нет: имя — единственное,
    // чем портфель и список проектов различимы снаружи.
    expect(screen.queryByRole("heading", { name: "Проекты" })).toBeNull();
  });

  it("даёт завести проект обоими способами, не уходя со страницы", async () => {
    server.use(
      ...sessionHandlers(),
      http.get("/api/projects", () => HttpResponse.json([])),
      http.post("/api/projects", async ({ request }) => {
        const body = (await request.json()) as { name: string };
        return HttpResponse.json({ id: "p1", name: body.name, slug: "novyy-proekt" });
      }),
      http.get("/api/projects/p1", () =>
        HttpResponse.json({
          id: "p1",
          name: "Новый проект",
          slug: "novyy-proekt",
          deadline: null,
          categories: [],
          tasks: [],
        }),
      ),
    );

    renderApp({ route: "/portfolio", locale: "ru" });

    expect(await screen.findByRole("link", { name: /создать через интервью/i })).toHaveAttribute(
      "href",
      "/projects/new/ai",
    );

    await userEvent.click(screen.getByRole("button", { name: /создать проект/i }));
    await userEvent.type(screen.getByLabelText(/название/i), "Новый проект");
    await userEvent.click(screen.getByRole("button", { name: /^создать$/i }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1"));
  });

  it("корень ведёт туда же, куда вход, — на список проектов", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/", locale: "ru" });

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/projects"));
    expect(await screen.findByRole("heading", { name: "Проекты" })).toBeInTheDocument();
  });

  it("при отказе загрузки не утверждает, что проектов нет", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.error()));

    renderApp({ route: "/", locale: "ru" });

    // Пустой список и несостоявшийся ответ — разные вещи: пока причина в
    // отказе, «проектов нет» было бы враньём поверх баннера ошибки.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/ни одного проекта/i)).not.toBeInTheDocument();
  });
});
