import { describe, expect, it } from "vitest";

import { formatEvent } from "./formatEvent";

describe("запись истории", () => {
  it("собирает фразу переноса на языке читателя", () => {
    const op = { type: "move_task", task_id: "t1", from: "2026-03-12", to: "2026-03-19" };
    expect(formatEvent(op, "ru")).toBe("перенёс старт с 12 мар на 19 мар");
    expect(formatEvent(op, "az")).toBe("başlanğıcı 12 mar → 19 mar dəyişdi");
  });

  it("склоняет длительность по правилам языка", () => {
    const op = { type: "set_duration", task_id: "t1", from: 14, to: 21 };
    expect(formatEvent(op, "ru")).toBe("изменил длительность с 14 дней на 21 день");
  });

  it("перечисляет только изменившиеся поля", () => {
    const op = {
      type: "set_task_fields",
      task_id: "t1",
      from: { name: "Лого", description: "", internal_note: "" },
      to: { name: "Лого", description: "Знак", internal_note: "" },
    };
    expect(formatEvent(op, "ru")).toBe("изменил описание");
  });

  it("не падает на неизвестном типе события", () => {
    expect(formatEvent({ type: "invented_later", task_id: "t1" }, "ru")).toBe("изменил задачу");
  });
});
