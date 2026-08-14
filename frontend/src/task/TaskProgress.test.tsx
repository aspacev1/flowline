import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { server } from "../test/server";
import { STATE, captureMutations, projectFixtures, renderProject } from "../test/project";

beforeEach(projectFixtures);

/** Открыть карточку щелчком по полоске. */
async function openPanel() {
  await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
}

describe("быстрый прогресс в карточке", () => {
  it("«Отметить день» прибавляет дневную норму одной операцией и гаснет", async () => {
    const sent = captureMutations();
    renderProject();
    await openPanel();

    // Пять рабочих дней — дневная норма 20%: 40 → 60.
    await userEvent.click(screen.getByRole("button", { name: "Отметить день · +20%" }));
    await waitFor(() =>
      expect(sent).toEqual([
        { op: { type: "set_progress", task_id: "t1", progress_pct: 60 } },
      ]),
    );

    // Погасшая кнопка защищает от двойного тапа: второй «день» за один заход
    // не записывается.
    expect(screen.getByRole("button", { name: "День отмечен" })).toBeDisabled();
  });

  it("шаги ±5 отсчитывают от текущей готовности", async () => {
    const sent = captureMutations();
    renderProject();
    await openPanel();

    await userEvent.click(
      screen.getByRole("button", { name: "Увеличить готовность на 5%" }),
    );
    await waitFor(() =>
      expect(sent[0].op).toMatchObject({ type: "set_progress", progress_pct: 45 }),
    );

    // Оптимистичная догадка уже подняла готовность до 45: минус считает от неё.
    await userEvent.click(
      screen.getByRole("button", { name: "Уменьшить готовность на 5%" }),
    );
    await waitFor(() =>
      expect(sent[1].op).toMatchObject({ type: "set_progress", progress_pct: 40 }),
    );
  });

  it("читателю прогресс виден, но кнопок и правки числа нет", async () => {
    renderProject(STATE, { canWrite: false });
    await openPanel();

    expect(screen.getByLabelText(/выполнено/i)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Отметить день/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Увеличить готовность на 5%" }),
    ).not.toBeInTheDocument();
  });

  it("под полосой — последние отметки прогресса, и только они", async () => {
    server.use(
      http.get("/api/projects/p1/revisions", () =>
        HttpResponse.json([
          {
            seq: 3,
            created_at: "2026-08-13T10:00:00Z",
            actor: { id: "u2", name: "Мария" },
            reason: null,
            batch_id: null,
            undoes_seq: null,
            op: { type: "set_progress", task_id: "t1", from: 30, to: 40 },
            names: {},
          },
          {
            seq: 2,
            created_at: "2026-08-12T10:00:00Z",
            actor: { id: "u1", name: "Алексей" },
            reason: null,
            batch_id: null,
            undoes_seq: null,
            op: { type: "move_task", task_id: "t1", from: "2026-03-04", to: "2026-03-05" },
            names: {},
          },
          {
            seq: 1,
            created_at: "2026-08-11T10:00:00Z",
            actor: { id: "u2", name: "Мария" },
            reason: null,
            batch_id: null,
            undoes_seq: null,
            op: { type: "set_progress", task_id: "t1", from: 10, to: 30 },
            names: {},
          },
        ]),
      ),
    );

    renderProject();
    await openPanel();

    const log = await screen.findByRole("list", { name: "Последние отметки" });
    const rows = within(log).getAllByRole("listitem");
    // Перенос даты в срез не попадает — это срез отметок, а не второй журнал.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Мария");
    expect(rows[0]).toHaveTextContent("30 → 40%");
    expect(rows[1]).toHaveTextContent("10 → 30%");
  });
});
