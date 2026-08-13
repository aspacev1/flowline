import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import { renderApp, sessionHandlers } from "../test/utils";

describe("главный экран", () => {
  it("называется так же, как пункт колонки, по которому сюда приходят", async () => {
    server.use(...sessionHandlers(), http.get("/api/projects", () => HttpResponse.json([])));

    renderApp({ route: "/", locale: "ru" });

    // Заголовок, а не любой текст: слово «Проекты» есть и в боковой колонке.
    expect(await screen.findByRole("heading", { name: "Проекты" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /все проекты/i })).not.toBeInTheDocument();
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

    renderApp({ route: "/", locale: "ru" });

    expect(await screen.findByRole("link", { name: /создать через интервью/i })).toHaveAttribute(
      "href",
      "/projects/new/ai",
    );

    await userEvent.click(screen.getByRole("button", { name: /создать проект/i }));
    await userEvent.type(screen.getByLabelText(/название/i), "Новый проект");
    await userEvent.click(screen.getByRole("button", { name: /^создать$/i }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/projects/p1"));
  });
});
