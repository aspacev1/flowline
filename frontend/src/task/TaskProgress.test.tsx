import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

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

  it("число прогресса тоже можно ввести напрямую", async () => {
    const sent = captureMutations();
    renderProject();
    await openPanel();

    await userEvent.clear(screen.getByLabelText(/выполнено/i));
    await userEvent.type(screen.getByLabelText(/выполнено/i), "75");

    await waitFor(() =>
      expect(sent).toContainEqual({
        op: { type: "set_progress", task_id: "t1", progress_pct: 75 },
      }),
    );
  });

  it("читателю прогресс виден, но кнопки отметки и правки числа нет", async () => {
    renderProject(STATE, { canWrite: false });
    await openPanel();

    expect(screen.getByLabelText(/выполнено/i)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Отметить день/ })).not.toBeInTheDocument();
  });
});
