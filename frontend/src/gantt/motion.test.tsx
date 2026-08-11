import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { matchMediaMock } from "../test/motion";
import { projectFixtures, renderProject } from "../test/project";

beforeEach(projectFixtures);
afterEach(() => vi.unstubAllGlobals());

describe("движение интерфейса", () => {
  it("отключает переходы, если человек просил меньше движения", async () => {
    matchMediaMock("(prefers-reduced-motion: reduce)", true);
    const { container } = renderProject();
    await screen.findByRole("button", { name: /Логотип/ });

    expect(container.querySelector(".gantt")).toHaveClass("motion-off");
  });

  it("оставляет переходы, если о них не просили", async () => {
    matchMediaMock("(prefers-reduced-motion: reduce)", false);
    const { container } = renderProject();
    await screen.findByRole("button", { name: /Логотип/ });

    expect(container.querySelector(".gantt")).not.toHaveClass("motion-off");
  });
});
