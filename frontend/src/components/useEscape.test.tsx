import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { APPROVED, captureMutations, projectFixtures, renderProject } from "../test/project";

beforeEach(projectFixtures);

/**
 * Esc глазами человека, у которого на экране больше одного слоя.
 *
 * Проверяется не устройство стопки, а обещание: одно нажатие снимает один
 * слой — тот, который человек открыл последним. Всё остальное остаётся, где
 * было, вместе с недописанным.
 */

const bar = () => screen.findByRole("button", { name: /Логотип/ });
const panel = () => screen.queryByRole("complementary");

describe("Esc при нескольких слоях", () => {
  it("закрывает окно причины, но оставляет карточку, из которой его открыли", async () => {
    const sent = captureMutations();
    renderProject(APPROVED);
    await userEvent.click(await bar());

    // Правка даты в карточке дальше порога — окно «объясните сдвиг» поверх неё.
    const start = await screen.findByLabelText(/старт/i);
    await userEvent.clear(start);
    await userEvent.type(start, "2026-03-25");
    await userEvent.tab();
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Главное: карточка на месте. Esc отменил сдвиг, а не работу над задачей.
    expect(panel()).toBeInTheDocument();
    expect(sent).toHaveLength(0);

    // Второе нажатие достаётся тому, что осталось внизу.
    await userEvent.keyboard("{Escape}");
    expect(panel()).not.toBeInTheDocument();
  });

  it("закрывает раскрытое меню ленты, но не карточку под ним", async () => {
    renderProject();
    await userEvent.click(await bar());

    await userEvent.click(screen.getByRole("button", { name: /Масштаб/ }));
    const scale = screen.getByRole("button", { name: /Масштаб/ });
    expect(scale).toHaveAttribute("aria-expanded", "true");

    await userEvent.keyboard("{Escape}");

    expect(scale).toHaveAttribute("aria-expanded", "false");
    expect(panel()).toBeInTheDocument();
  });

  it("снимает вопрос об удалении, а не карточку с задачей, о которой он", async () => {
    renderProject();
    await userEvent.click(await bar());

    await userEvent.click(screen.getByRole("button", { name: "Удалить задачу" }));
    expect(screen.getByRole("button", { name: "Да, удалить" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: "Да, удалить" })).not.toBeInTheDocument();
    expect(panel()).toBeInTheDocument();
  });

  it("не путает порядок, когда нижний слой уходит раньше верхнего", async () => {
    renderProject();
    await userEvent.click(await bar());

    // Меню поверх карточки, но карточку закрывают мышью — стопка обязана
    // забыть именно её, а не верхний слой.
    await userEvent.click(screen.getByRole("button", { name: /Масштаб/ }));
    await userEvent.click(screen.getByRole("button", { name: "Закрыть карточку" }));
    expect(panel()).not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /Масштаб/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
