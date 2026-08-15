import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmAction } from "./ConfirmAction";
import { renderWithProviders } from "../test/utils";

function renderAction(onConfirm = vi.fn(), disabled = false) {
  renderWithProviders(
    <ConfirmAction
      label="Отозвать"
      warning="Ссылка перестанет работать"
      confirm="Да, отозвать"
      onConfirm={onConfirm}
      disabled={disabled}
    />,
    { locale: "ru" },
  );
  return onConfirm;
}

describe("подтверждение на месте", () => {
  it("первое нажатие ничего не делает, а называет последствие", async () => {
    const onConfirm = renderAction();

    await userEvent.click(screen.getByRole("button", { name: "Отозвать" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Ссылка перестанет работать")).toBeInTheDocument();
    // Кнопка подтверждения называет действие, а не отвечает «да, продолжить»:
    // в списке из трёх кнопок подряд «да» относилось бы к любой из них.
    expect(screen.getByRole("button", { name: "Да, отозвать" })).toBeInTheDocument();
  });

  it("отказ возвращает кнопку и не трогает действие", async () => {
    const onConfirm = renderAction();

    await userEvent.click(screen.getByRole("button", { name: "Отозвать" }));
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Отозвать" })).toBeInTheDocument();
    expect(screen.queryByText("Ссылка перестанет работать")).not.toBeInTheDocument();
  });

  it("подтверждение выполняет действие и сворачивает вопрос", async () => {
    const onConfirm = renderAction();

    await userEvent.click(screen.getByRole("button", { name: "Отозвать" }));
    await userEvent.click(screen.getByRole("button", { name: "Да, отозвать" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Отозвать" })).toBeInTheDocument();
  });

  it("фокус переходит на саму выноску, а не на подтверждение", async () => {
    renderAction();

    // Кнопка исчезает вместе с нажатием, и без переноса фокус свалился бы в
    // начало страницы: с клавиатуры до вопроса было бы не добраться. На
    // подтверждении фокуса нет намеренно — Enter, нажатый по инерции, не
    // должен подтверждать то, о чём только что спросили.
    await userEvent.click(screen.getByRole("button", { name: "Отозвать" }));

    const group = screen.getByRole("group", { name: "Ссылка перестанет работать" });
    expect(group).toHaveFocus();
    expect(screen.getByRole("button", { name: "Да, отозвать" })).not.toHaveFocus();
  });

  it("занятое действие не подтверждается дважды", async () => {
    const onConfirm = renderAction(vi.fn(), true);

    // Кнопка заблокирована с самого начала: пока запрос в пути, второй такой
    // же ничего не улучшит, а перевыпуск повторит дважды.
    expect(screen.getByRole("button", { name: "Отозвать" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Отозвать" }));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
