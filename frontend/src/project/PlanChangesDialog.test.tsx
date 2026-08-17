import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { ProjectState } from "../api/projects";
import { APPROVED, APPROVED_WITH_EXTRA, projectFixtures, renderProject } from "../test/project";
import { server } from "../test/server";

beforeEach(projectFixtures);

/** Задача уехала на пять дней вперёд — сдвиг, который окно обязано назвать. */
const MOVED: ProjectState = {
  ...APPROVED,
  tasks: [{ ...APPROVED.tasks[0], start_date: "2026-03-09", end_date: "2026-03-13" }],
};

/** Та же задача, растянутая с пяти дней до восьми. */
const STRETCHED: ProjectState = {
  ...APPROVED,
  tasks: [{ ...APPROVED.tasks[0], duration_days: 8, end_date: "2026-03-13" }],
};

/** Летопись версий: снимок знает задачу, которой в проекте уже нет. */
function withApprovals(snapshot: Record<string, unknown>) {
  server.use(
    http.get("/api/projects/p1/plan/approvals", () =>
      HttpResponse.json([
        {
          version: 1,
          approved_at: "2026-03-01T09:00:00+00:00",
          approved_by: { id: "u1", name: "Алексей" },
          snapshot,
        },
      ]),
    ),
  );
}

/** Открыть список изменений так, как его открывает человек, — из шапки. */
async function openChanges(state: ProjectState = MOVED) {
  renderProject(state);
  await userEvent.click(await screen.findByRole("button", { name: /изменен/i }));
  return screen.findByRole("dialog");
}

describe("окно изменений плана", () => {
  it("называет сдвиг парой «было → стало» и величиной", async () => {
    const dialog = await openChanges();

    // Пара дат отвечает на «что именно поехало», бейдж — на «насколько».
    // Порознь ни то ни другое не отвечает ни на один из этих вопросов.
    expect(within(dialog).getByText("4 мар → 9 мар")).toBeInTheDocument();
    expect(within(dialog).getByText("+5 дн.")).toBeInTheDocument();
  });

  it("приближение к сроку не набирается цветом тревоги", async () => {
    const dialog = await openChanges({
      ...APPROVED,
      tasks: [{ ...APPROVED.tasks[0], start_date: "2026-03-02", end_date: "2026-03-06" }],
    });

    // Хорошая новость обязана выглядеть хорошей: у бейджа тот же зелёный, что
    // и у бейджа приближения на полоске ленты.
    expect(within(dialog).getByText("−2 дн.")).toHaveClass("is-early");
  });

  it("растянутая задача попадает в свою группу, а не в сдвиги", async () => {
    const dialog = await openChanges(STRETCHED);

    expect(within(dialog).getByText("Длительность")).toBeInTheDocument();
    expect(within(dialog).queryByText("Сдвиги дат")).toBeNull();
    expect(within(dialog).getByText("5 дн. → 8 дн.")).toBeInTheDocument();
  });

  it("работу сверх плана показывает отдельно: сравнивать её не с чем", async () => {
    const dialog = await openChanges(APPROVED_WITH_EXTRA);

    expect(within(dialog).getByText("Новые задачи")).toBeInTheDocument();
    expect(within(dialog).getByText("вне плана")).toBeInTheDocument();
  });

  it("удалённую задачу знает по снимку версии — в состоянии её уже нет", async () => {
    withApprovals({
      t1: { name: "Логотип", start_date: "2026-03-04", duration_days: 5 },
      gone: { name: "Согласование бюджета", start_date: "2026-03-04", duration_days: 2 },
    });
    const dialog = await openChanges();

    expect(await within(dialog).findByText("Согласование бюджета")).toBeInTheDocument();
    expect(within(dialog).getByText("Удалённые задачи")).toBeInTheDocument();
  });

  it("показывает причину сдвига там, где о ней спрашивали", async () => {
    server.use(
      http.get("/api/projects/p1/revisions", () =>
        HttpResponse.json([
          {
            seq: 7,
            created_at: "2026-03-05T10:00:00+00:00",
            actor: { id: "u1", name: "Алексей" },
            reason: "Ждали контент от клиента",
            batch_id: null,
            undoes_seq: null,
            op: { type: "move_task", task_id: "t1", start_date: "2026-03-09" },
            names: { t1: "Логотип" },
          },
        ]),
      ),
    );
    const dialog = await openChanges();

    // Причины уже вводят при сдвиге за порог — здесь они наконец отвечают на
    // «почему», а не только на «что».
    expect(await within(dialog).findByText("Ждали контент от клиента")).toBeInTheDocument();
  });

  it("причина, названная до согласования, к расхождению не приписывается", async () => {
    server.use(
      http.get("/api/projects/p1/revisions", () =>
        HttpResponse.json([
          {
            seq: 3,
            // Раньше согласования: этот сдвиг сам вошёл в базовый план.
            created_at: "2026-02-20T10:00:00+00:00",
            actor: null,
            reason: "Старое объяснение",
            batch_id: null,
            undoes_seq: null,
            op: { type: "move_task", task_id: "t1", start_date: "2026-03-04" },
            names: { t1: "Логотип" },
          },
        ]),
      ),
    );
    const dialog = await openChanges();

    await within(dialog).findByText("4 мар → 9 мар");
    expect(within(dialog).queryByText("Старое объяснение")).toBeNull();
  });

  it("одну причину не печатает дважды, когда задачу и подвинули, и растянули", async () => {
    server.use(
      http.get("/api/projects/p1/revisions", () =>
        HttpResponse.json([
          {
            seq: 9,
            created_at: "2026-03-05T10:00:00+00:00",
            actor: { id: "u1", name: "Алексей" },
            reason: "Заказчик расширил объём",
            batch_id: null,
            undoes_seq: null,
            op: {
              type: "resize_task",
              task_id: "t1",
              start_date: "2026-03-09",
              duration_days: 8,
            },
            names: { t1: "Логотип" },
          },
        ]),
      ),
    );
    const dialog = await openChanges({
      ...APPROVED,
      tasks: [
        {
          ...APPROVED.tasks[0],
          start_date: "2026-03-09",
          end_date: "2026-03-18",
          duration_days: 8,
        },
      ],
    });

    // Задача стоит в двух группах, а объяснение у неё одно: напечатанное
    // подряд дважды, оно читается сбоем, а не причиной.
    await within(dialog).findByText("Заказчик расширил объём");
    expect(within(dialog).getAllByText("Заказчик расширил объём")).toHaveLength(1);
  });

  it("под фильтром по группе причина остаётся при своей строке", async () => {
    server.use(
      http.get("/api/projects/p1/revisions", () =>
        HttpResponse.json([
          {
            seq: 9,
            created_at: "2026-03-05T10:00:00+00:00",
            actor: null,
            reason: "Заказчик расширил объём",
            batch_id: null,
            undoes_seq: null,
            op: {
              type: "resize_task",
              task_id: "t1",
              start_date: "2026-03-09",
              duration_days: 8,
            },
            names: { t1: "Логотип" },
          },
        ]),
      ),
    );
    const dialog = await openChanges({
      ...APPROVED,
      tasks: [
        {
          ...APPROVED.tasks[0],
          start_date: "2026-03-09",
          end_date: "2026-03-18",
          duration_days: 8,
        },
      ],
    });

    await within(dialog).findByText("Заказчик расширил объём");
    await userEvent.click(within(dialog).getByRole("button", { name: "Длительность · 1" }));

    // Соседней строки на экране больше нет, и молчать теперь не о чем.
    expect(within(dialog).getByText("Заказчик расширил объём")).toBeInTheDocument();
  });

  it("фильтр по группе оставляет только её", async () => {
    const dialog = await openChanges({
      ...APPROVED_WITH_EXTRA,
      tasks: [
        { ...APPROVED.tasks[0], start_date: "2026-03-09", end_date: "2026-03-13" },
        ...APPROVED_WITH_EXTRA.tasks.slice(1),
      ],
    });

    expect(within(dialog).getByText("Новые задачи")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Сдвиги дат · 1" }));

    expect(within(dialog).getByText("Сдвиги дат")).toBeInTheDocument();
    expect(within(dialog).queryByText("Новые задачи")).toBeNull();
  });

  it("имя задачи ведёт в её карточку, а окно уходит с дороги", async () => {
    const dialog = await openChanges();

    await userEvent.click(within(dialog).getByRole("button", { name: "Логотип" }));

    // Увидев расхождение, идут чинить именно эту задачу — и путь туда не должен
    // проходить через закрытие окна и поиск строки глазами.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("complementary")).toBeInTheDocument();
  });

  it("владелец переутверждает прямо отсюда — список он только что прочитал", async () => {
    const approvals: number[] = [];
    server.use(
      http.post("/api/projects/p1/plan/approvals", () => {
        approvals.push(1);
        return HttpResponse.json(
          { version: 2, approved_at: "2026-03-10T09:00:00+00:00" },
          { status: 201 },
        );
      }),
    );
    const dialog = await openChanges();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Переутвердить как v2" }),
    );

    // Повторного «вы уверены» здесь нет намеренно: окно уже показало поимённо
    // всё, что станет новой базой.
    await waitFor(() => expect(approvals).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("не владельцу переутверждения не предлагает вовсе", async () => {
    renderProject(MOVED, { canWrite: false });
    await userEvent.click(await screen.findByRole("button", { name: /изменен/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /Переутвердить/ })).toBeNull();
  });

  it("отказ журнала и летописи окно не ломает", async () => {
    // Роль без права на журнал получает отказ, и список расхождений от этого
    // не портится: причины и удалённые — добавка, а не основа.
    server.use(
      http.get("/api/projects/p1/revisions", () => new HttpResponse(null, { status: 403 })),
      http.get("/api/projects/p1/plan/approvals", () => new HttpResponse(null, { status: 403 })),
    );
    const dialog = await openChanges();

    expect(within(dialog).getByText("4 мар → 9 мар")).toBeInTheDocument();
  });
});

describe("подтверждение переутверждения", () => {
  it("называет объём того, что станет новой базой", async () => {
    renderProject(MOVED);

    await userEvent.click(await screen.findByRole("button", { name: "Пересогласовать" }));

    // Прежде вопрос предупреждал о последствии, но не называл его размера, и
    // «да» приходилось говорить вслепую.
    expect(
      screen.getByText("Новой базой станет то, что уже изменено: 1 задача"),
    ).toBeInTheDocument();
  });

  it("из подтверждения можно посмотреть, что именно фиксируется", async () => {
    renderProject(MOVED);

    await userEvent.click(await screen.findByRole("button", { name: "Пересогласовать" }));
    await userEvent.click(screen.getByRole("button", { name: "Посмотреть изменения" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("4 мар → 9 мар")).toBeInTheDocument();
  });
});
