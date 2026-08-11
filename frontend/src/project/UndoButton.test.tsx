import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { STATE, projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";

beforeEach(projectFixtures);

/** Состояние, в котором есть что отменять. */
const WITH_UNDO = {
  ...STATE,
  undoable: {
    seq: 7,
    op: { type: "move_task", task_id: "t1", from: "2026-03-04", to: "2026-03-11" },
    batch_id: null,
  },
};

describe("кнопка отмены", () => {
  it("называет, что именно она отменит", async () => {
    renderProject(WITH_UNDO);

    // Не «Отменить» вообще: вспоминают последнее действие неверно как раз
    // тогда, когда торопятся исправить ошибку.
    expect(await screen.findByRole("button", { name: /Отменить: перенёс старт/ })).toBeInTheDocument();
  });

  it("не показывается, когда отменять нечего", async () => {
    renderProject(); // undoable: null
    await screen.findByRole("button", { name: /Логотип/ });

    expect(screen.queryByRole("button", { name: /Отменить/ })).toBeNull();
  });

  it("не показывается наблюдателю", async () => {
    renderProject(WITH_UNDO, { canWrite: false });
    await screen.findByRole("button", { name: /Логотип/ });

    expect(screen.queryByRole("button", { name: /Отменить/ })).toBeNull();
  });

  it("зовёт отмену последнего изменения", async () => {
    let called = 0;
    server.use(
      http.post("/api/projects/p1/undo", () => {
        called += 1;
        return HttpResponse.json({ seq: 8 }, { status: 201 });
      }),
    );
    renderProject(WITH_UNDO);

    await userEvent.click(await screen.findByRole("button", { name: /Отменить:/ }));

    await waitFor(() => expect(called).toBe(1));
  });

  it("пачку откатывает целиком, а не по одной операции", async () => {
    let batchCalls = 0;
    server.use(
      http.post("/api/projects/p1/batches/:batchId/undo", () => {
        batchCalls += 1;
        return HttpResponse.json({ undone: 12 }, { status: 201 });
      }),
    );
    renderProject({
      ...WITH_UNDO,
      undoable: { ...WITH_UNDO.undoable, batch_id: "b1" },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Отменить всю пачку" }));

    await waitFor(() => expect(batchCalls).toBe(1));
  });

  it("отмена, пробивающая порог, спрашивает причину и повторяется с ней", async () => {
    const reasons: (string | undefined)[] = [];
    server.use(
      http.post("/api/projects/p1/undo", async ({ request }) => {
        const body = (await request.json()) as { reason?: string };
        reasons.push(body.reason);
        if (body.reason === undefined) {
          return HttpResponse.json(
            { detail: "reason_required" },
            {
              status: 409,
              headers: { "X-Shift-Deviation-Days": "14", "X-Shift-Threshold-Days": "2" },
            },
          );
        }
        return HttpResponse.json({ seq: 9 }, { status: 201 });
      }),
    );
    renderProject(WITH_UNDO);

    await userEvent.click(await screen.findByRole("button", { name: /Отменить:/ }));

    expect(await screen.findByRole("dialog")).toHaveTextContent(/Сдвиг на 14 дней/);
    await userEvent.type(screen.getByLabelText("Причина"), "всё-таки сдвигаем");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(reasons).toEqual([undefined, "всё-таки сдвигаем"]));
  });
});
