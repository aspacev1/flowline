import { describe, expect, it } from "vitest";

import { flattenKeys as flatten, translate } from "./index";

describe("переводы", () => {
  it("подставляет параметры", () => {
    expect(translate("ru", "auth.greeting", { name: "Алексей" })).toBe("Привет, Алексей");
  });

  it("склоняет русские числительные по настоящим правилам", () => {
    expect(translate("ru", "common.days", { count: 1 })).toBe("1 день");
    expect(translate("ru", "common.days", { count: 3 })).toBe("3 дня");
    expect(translate("ru", "common.days", { count: 5 })).toBe("5 дней");
    expect(translate("ru", "common.days", { count: 21 })).toBe("21 день");
    expect(translate("ru", "common.days", { count: 112 })).toBe("112 дней");
  });

  it("падает на азербайджанский, если ключа нет", () => {
    expect(translate("en", "missing.key.for.test")).toBe(translate("az", "missing.key.for.test"));
  });

  it("возвращает сам ключ, если его нет нигде", () => {
    expect(translate("en", "totally.unknown")).toBe("totally.unknown");
  });
});

describe("полнота словарей", () => {
  it("во всех языках один и тот же набор ключей", async () => {
    const [az, en, ru] = await Promise.all([
      import("./az.json"),
      import("./en.json"),
      import("./ru.json"),
    ]);
    const keys = (o: object) => Object.keys(flatten(o)).sort();
    expect(keys(en.default)).toEqual(keys(az.default));
    expect(keys(ru.default)).toEqual(keys(az.default));
  });
});
