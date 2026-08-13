import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  APPROVED,
  APPROVED_WITH_EXTRA,
  STATE,
  projectFixtures,
  renderProject,
} from "../test/project";

beforeEach(projectFixtures);

describe("шапка проекта", () => {
  it("называет срок работ и объём проекта", async () => {
    renderProject();

    // Срок — от самого раннего старта до посчитанного сервером окончания, а не
    // до конца последней задачи: окончание бывает позже её.
    expect(await screen.findByText("4 марта — 8 июня · 2 категории, 1 задача")).toBeInTheDocument();
  });

  it("проект без задач срока не выдумывает", async () => {
    renderProject({ ...STATE, tasks: [], project_end: null });

    expect(await screen.findByText("2 категории, 0 задач")).toBeInTheDocument();
  });

  it("несогласованный план так и называет себя черновиком", async () => {
    renderProject();

    expect(await screen.findByText("План проекта · черновик")).toBeInTheDocument();
    expect(screen.queryByText("изменён после согласования")).toBeNull();
  });

  it("согласованный план показывает версию", async () => {
    renderProject(APPROVED);

    expect(await screen.findByText("План проекта · v1")).toBeInTheDocument();
    // Даты совпадают с базовым планом: расхождению взяться неоткуда, и
    // пометка о нём была бы ложной тревогой.
    expect(screen.queryByText("изменён после согласования")).toBeNull();
  });

  it("бейдж плана называет своё состояние, а не только текст", async () => {
    // Черновик и согласованный план различаются цветом бейджа, и цвет тема
    // берёт из `data-state`: без него оба остались бы янтарными — то есть
    // согласованный план всё время требовал бы внимания.
    renderProject();
    expect(await screen.findByText("План проекта · черновик")).toHaveAttribute(
      "data-state",
      "draft",
    );

    renderProject(APPROVED);
    expect(await screen.findByText("План проекта · v1")).toHaveAttribute("data-state", "approved");
  });

  it("состояние плана стоит в строке названия, а не хвостом за сводкой", async () => {
    renderProject(APPROVED);

    // Проверяется именно место: текст плашки виден и в сводке, а расхождение с
    // согласованным планом читают вместе с именем проекта.
    const label = await screen.findByText("План проекта · v1");
    expect(label.closest(".project-head__title-row")).not.toBeNull();
    expect(label.closest(".project-head__meta")).toBeNull();
  });

  it("публикация стоит в общем ряду действий, а не вплотную к названию", async () => {
    renderProject();

    const share = await screen.findByRole("button", { name: "Поделиться" });
    expect(share.closest(".project-head__actions")).not.toBeNull();
  });

  it("работа сверх плана помечает план как изменённый", async () => {
    renderProject(APPROVED_WITH_EXTRA);

    expect(await screen.findByText("изменён после согласования")).toBeInTheDocument();
  });

  it("уехавшая от базового плана задача помечает план как изменённый", async () => {
    renderProject({
      ...APPROVED,
      tasks: [{ ...APPROVED.tasks[0], start_date: "2026-03-11", end_date: "2026-03-17" }],
    });

    expect(await screen.findByText("изменён после согласования")).toBeInTheDocument();
  });
});
