import { describe, expect, it } from "vitest";

import {
  COLUMN_KEYS,
  DEFAULT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  clampWidth,
  defaultLayout,
  layoutWidth,
  rememberLayout,
  storedLayout,
} from "./columns";

describe("раскладка колонок", () => {
  it("на широком экране открывается именем и обеими датами", () => {
    expect(defaultLayout(1440).shown).toEqual(["task", "start", "end"]);
  });

  it("на узком — одним именем: ленте нужно место, ради неё и пришли", () => {
    expect(defaultLayout(520).shown).toEqual(["task"]);
    expect(defaultLayout(520).widths.task).toBeLessThan(DEFAULT_WIDTH.task);
  });

  it("без окна не выдумывает телефон", () => {
    expect(defaultLayout(0).shown).toEqual(["task", "start", "end"]);
  });

  it("ширина колонки — сумма показанных, а не всех", () => {
    const layout = defaultLayout(1440);
    expect(layoutWidth(layout)).toBe(
      DEFAULT_WIDTH.task + DEFAULT_WIDTH.start + DEFAULT_WIDTH.end,
    );
  });

  it("ширина держится в границах, за которыми колонка перестаёт быть колонкой", () => {
    expect(clampWidth(1)).toBe(MIN_WIDTH);
    expect(clampWidth(9999)).toBe(MAX_WIDTH);
    expect(clampWidth(120.4)).toBe(120);
  });
});

describe("память раскладки", () => {
  it("возвращает то, что положили", () => {
    const layout = { shown: ["task" as const, "duration" as const], widths: { ...DEFAULT_WIDTH } };
    rememberLayout("p1", layout);

    expect(storedLayout("p1")).toEqual(layout);
  });

  it("порядок колонок задаёт код, а не хранилище", () => {
    // Запись будущей версии могла бы переставить колонки местами; читаться она
    // обязана в объявленном порядке.
    localStorage.setItem(
      "planora.gantt_columns.p2",
      JSON.stringify({ shown: ["end", "start"], widths: {} }),
    );

    expect(storedLayout("p2")?.shown).toEqual(["task", "start", "end"]);
  });

  it("кривая запись — это «показать по умолчанию», а не колонка-призрак", () => {
    localStorage.setItem("planora.gantt_columns.p3", "{ не json");
    expect(storedLayout("p3")).toBeNull();

    localStorage.setItem("planora.gantt_columns.p4", JSON.stringify({ shown: "всё" }));
    expect(storedLayout("p4")).toBeNull();
  });

  it("незнакомую колонку из хранилища не пускает в раскладку", () => {
    localStorage.setItem(
      "planora.gantt_columns.p5",
      JSON.stringify({ shown: ["start", "звёздочки"], widths: { звёздочки: 200 } }),
    );

    const layout = storedLayout("p5");
    expect(layout?.shown).toEqual(["task", "start"]);
    expect(Object.keys(layout?.widths ?? {}).sort()).toEqual([...COLUMN_KEYS].sort());
  });

  it("ширину из хранилища прижимает к границам", () => {
    localStorage.setItem(
      "planora.gantt_columns.p6",
      JSON.stringify({ shown: ["task"], widths: { task: 10_000 } }),
    );

    expect(storedLayout("p6")?.widths.task).toBe(MAX_WIDTH);
  });
});
