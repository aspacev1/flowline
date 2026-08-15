import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "./toast";

/** Две кнопки, каждая со своим тостом: смену тоста иначе не воспроизвести. */
function Harness() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast({ message: "Задача перенесена" })}>
        Первый
      </button>
      <button type="button" onClick={() => toast({ message: "Задача возвращена" })}>
        Второй
      </button>
    </>
  );
}

describe("тост", () => {
  it("появляется заново, когда один тост сменяет другой", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Первый" }));
    const first = screen.getByRole("status");

    await user.click(screen.getByRole("button", { name: "Второй" }));
    const second = screen.getByRole("status");

    expect(second).toHaveTextContent("Задача возвращена");
    // Узел именно новый, а не переписанный: появление тоста нарисовано
    // анимацией, а она играет один раз на узел — сменив только текст, второй
    // тост возник бы срезом там, где первый выехал.
    expect(second).not.toBe(first);
  });
});
