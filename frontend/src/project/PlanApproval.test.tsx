import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { APPROVED, projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";

beforeEach(projectFixtures);

/** Утверждения плана, ушедшие на сервер за тест. */
function captureApprovals(): number[] {
  const calls: number[] = [];
  server.use(
    http.post("/api/projects/p1/plan/approvals", () => {
      calls.push(calls.length + 1);
      return HttpResponse.json(
        { version: calls.length, approved_at: "2026-03-01T09:00:00+00:00" },
        { status: 201 },
      );
    }),
  );
  return calls;
}

describe("согласование плана", () => {
  it("черновик предлагает утвердить, и это уходит одним щелчком", async () => {
    const approvals = captureApprovals();
    renderProject();

    await userEvent.click(await screen.findByRole("button", { name: "Согласовать план" }));

    await waitFor(() => expect(approvals).toHaveLength(1));
  });

  it("согласованный план предлагает пересогласовать — и спрашивает подтверждение", async () => {
    const approvals = captureApprovals();
    renderProject(APPROVED);

    await userEvent.click(await screen.findByRole("button", { name: "Пересогласовать" }));

    // Один щелчок ничего не пересогласовывает: действие сдвигает базу, от которой
    // считаются все объяснённые сдвиги.
    expect(approvals).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Да, пересогласовать" }));
    await waitFor(() => expect(approvals).toHaveLength(1));
  });

  it("наблюдателю кнопки не показываются вовсе", async () => {
    renderProject(APPROVED, { canWrite: false });
    await screen.findByRole("button", { name: /Логотип/ });

    expect(screen.queryByRole("button", { name: /Согласовать|Пересогласовать/ })).toBeNull();
  });
});
