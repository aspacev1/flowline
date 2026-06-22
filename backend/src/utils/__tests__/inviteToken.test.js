import { describe, it, expect } from "vitest";
import { generateInviteToken } from "../inviteToken.js";

describe("generateInviteToken", () => {
  it("returns a base64url string with no padding or unsafe characters", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a string at least 40 characters long for 32 random bytes", () => {
    const token = generateInviteToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it("returns a different value on each call", () => {
    expect(generateInviteToken()).not.toBe(generateInviteToken());
  });
});
