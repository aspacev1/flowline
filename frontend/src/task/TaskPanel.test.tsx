import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { STATE, projectFixtures, renderProject } from "../test/project";

beforeEach(projectFixtures);

describe("карточка задачи", () => {
  it("по умолчанию скрыта, открывается кликом по задаче", async () => {
    renderProject();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("закрывается по Esc, крестиком и повторным кликом по той же задаче", async () => {
    renderProject();
    const bar = await screen.findByRole("button", { name: /Логотип/ });

    await userEvent.click(bar);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    await userEvent.click(bar);
    await userEvent.click(screen.getByRole("button", { name: /закрыть/i }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    await userEvent.click(bar);
    await userEvent.click(bar);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("не показывает блок внутренней заметки, если сервер её не прислал", async () => {
    const withoutNote = { ...STATE, tasks: [{ ...STATE.tasks[0] }] };
    delete (withoutNote.tasks[0] as { internal_note?: string }).internal_note;
    renderProject(withoutNote);

    await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
    expect(screen.queryByLabelText(/внутренняя заметка/i)).not.toBeInTheDocument();
  });

  it("показывает вычисленную сервером дату окончания и не считает её сама", async () => {
    renderProject();
    await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
    expect(screen.getByText("10 мар")).toBeInTheDocument();
  });
});
