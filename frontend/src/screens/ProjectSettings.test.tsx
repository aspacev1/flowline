import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";
import { ORG } from "../test/utils";

beforeEach(projectFixtures);

// Публикация висит на этом же экране: тест про удаление не должен падать на
// запросе, к которому не имеет отношения. Не опубликовано.
beforeEach(() => {
  server.use(
    http.get("/api/projects/p1/share", () =>
      HttpResponse.json({ allowed: true, url: null, comments_enabled: true, created_at: null }),
    ),
  );
});

describe("удаление проекта", () => {
  it("владелец удаляет проект после подтверждения и попадает к списку", async () => {
    let deleted = false;
    server.use(
      // Список, куда экран уводит после удаления. Пустой: проект только что
      // удалили, и других в оснастке нет.
      http.get("/api/projects", () => HttpResponse.json([])),
      http.delete("/api/projects/p1", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderProject(undefined, { route: "/projects/p1/settings" });

    await userEvent.click(await screen.findByRole("button", { name: "Удалить проект" }));
    // Первое нажатие ничего не удаляет — разворачивает подтверждение.
    expect(deleted).toBe(false);
    expect(screen.getByText(/отменить это будет нельзя/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Да, удалить проект" }));

    await waitFor(() => expect(deleted).toBe(true));
    // Переход проверяется по адресу, как его видит человек, а не по вызову
    // navigate (см. LocationProbe в test/utils).
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/projects"),
    );
  });

  it("подтверждение можно передумать", async () => {
    renderProject(undefined, { route: "/projects/p1/settings" });

    await userEvent.click(await screen.findByRole("button", { name: "Удалить проект" }));
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(screen.getByRole("button", { name: "Удалить проект" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Да, удалить проект" }),
    ).not.toBeInTheDocument();
  });

  it("редактору кнопка удаления не показывается", async () => {
    // Позже оснастки — значит, перебивает её обработчик роли owner: msw
    // отдаёт предпочтение зарегистрированному последним.
    server.use(http.get("/api/org", () => HttpResponse.json({ ...ORG, role: "editor" })));
    renderProject(undefined, { route: "/projects/p1/settings" });

    // Экран загружен: настройки уже видны.
    await screen.findByLabelText("Название");
    expect(screen.queryByRole("button", { name: "Удалить проект" })).not.toBeInTheDocument();
  });
});
