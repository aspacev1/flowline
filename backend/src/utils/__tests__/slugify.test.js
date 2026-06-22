import { describe, it, expect } from "vitest";
import { slugifyOrgName } from "../slugify.js";

describe("slugifyOrgName", () => {
  it("lowercases and replaces non-alphanumeric runs with a single dash", () => {
    expect(slugifyOrgName("Acme Inc.")).toBe("acme-inc");
  });

  it("strips leading/trailing dashes", () => {
    expect(slugifyOrgName("  --Acme--  ")).toBe("acme");
  });

  it("falls back to 'org' for empty/symbol-only input", () => {
    expect(slugifyOrgName("!!!")).toBe("org");
  });

  it("appends the suffix when provided", () => {
    expect(slugifyOrgName("Acme", "x7q2")).toBe("acme-x7q2");
  });
});
