import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { captureMutations, projectFixtures, renderProject, WITH_DEPENDENCY } from "../test/project";

beforeEach(projectFixtures);

/**
 * Статус и связи — то, чем карточка пополнилась при сведении с макетом
 * Planora: статус назначается руками, связи правятся отсюда, а не только
 * рисуются стрелками.
 */
describe("карточка: статус и связи", () => {
  it("смена статуса уходит операцией set_status", async () => {
    const sent = captureMutations();
    renderProject(WITH_DEPENDENCY);

    await userEvent.click(await screen.findByRole("button", { name: /^Логотип, / }));
    await userEvent.selectOptions(screen.getByLabelText("Статус"), "blocked");

    await waitFor(() =>
      expect(sent[0].op).toEqual({ type: "set_status", task_id: "t1", status: "blocked" }),
    );
  });

  it("показывает обе стороны связи и умеет её снять", async () => {
    const sent = captureMutations();
    renderProject(WITH_DEPENDENCY);

    // У приёмника связь видна как «зависит от».
    await userEvent.click(await screen.findByRole("button", { name: /^Макет, / }));
    const depends = screen.getByText("Зависит от").closest(".panel__deps")!;
    expect(within(depends as HTMLElement).getByText("Логотип")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Убрать связь с «Логотип»" }),
    );
    await waitFor(() =>
      expect(sent[0].op).toEqual({
        type: "remove_dependency",
        from_task_id: "t1",
        to_task_id: "t2",
      }),
    );
  });

  it("новая связь добавляется из списка кандидатов", async () => {
    const sent = captureMutations();
    renderProject(WITH_DEPENDENCY);

    await userEvent.click(await screen.findByRole("button", { name: /^Логотип, / }));
    // У «Логотипа» уже есть исходящая связь на «Макет», поэтому кандидат
    // остаётся только в списке «зависит от» — и это не «Макет»: обратная
    // сторона существующей связи была бы циклом.
    const depends = screen.getByText("Зависит от").closest(".panel__deps")!;
    const picker = within(depends as HTMLElement).queryByRole("combobox");
    // Кандидатов нет: единственная другая задача — «Макет», а он исключён.
    expect(picker).toBeNull();

    // Зато со стороны «Макета» связь добавить можно — на самого «Логотипа»
    // она уже есть, значит список пуст и там. Проверяем добавление на третьей
    // задаче не выйдет — её нет; вместо этого снимем и вернём связь.
    await userEvent.click(screen.getByRole("button", { name: /^Макет, / }));
    await userEvent.click(
      screen.getByRole("button", { name: "Убрать связь с «Логотип»" }),
    );
    await waitFor(() => expect(sent).toHaveLength(1));

    const dependsNow = screen.getByText("Зависит от").closest(".panel__deps")!;
    await userEvent.selectOptions(
      within(dependsNow as HTMLElement).getByRole("combobox"),
      "t1",
    );
    await waitFor(() =>
      expect(sent[1].op).toEqual({
        type: "add_dependency",
        from_task_id: "t1",
        to_task_id: "t2",
      }),
    );
  });
});
