import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

describe("apple oauth module", () => {
  beforeEach(() => {
    process.env.APPLE_CLIENT_ID = "apple-client-id";
    process.env.APPLE_TEAM_ID = "team-id";
    process.env.APPLE_KEY_ID = "key-id";
    process.env.APPLE_PRIVATE_KEY =
      "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIBaW4B... (test key not real)\n-----END EC PRIVATE KEY-----";
    process.env.OAUTH_REDIRECT_BASE_URL = "http://localhost:8080";
  });

  it("getAuthUrl builds an Apple authorization URL", async () => {
    const { getAuthUrl } = await import("../apple.js");
    const url = getAuthUrl("state-value");
    expect(url).toContain("https://appleid.apple.com/auth/authorize");
    expect(url).toContain("client_id=apple-client-id");
    expect(url).toContain("state=state-value");
  });

  it("exchangeCode decodes the id_token and returns normalized profile fields", async () => {
    vi.spyOn(jwt, "sign").mockReturnValue("fake-client-secret");
    const fakeIdToken = jwt.sign(
      { sub: "apple-user-1", email: "person@example.com", email_verified: "true" },
      "irrelevant-because-mocked",
      { algorithm: "none" }
    );
    vi.spyOn(jwt, "decode").mockReturnValue({
      sub: "apple-user-1",
      email: "person@example.com",
      email_verified: "true",
    });

    const fakeFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id_token: fakeIdToken }),
    });

    const { exchangeCode } = await import("../apple.js");
    const profile = await exchangeCode("code", fakeFetch);

    expect(profile).toEqual({
      providerUserId: "apple-user-1",
      email: "person@example.com",
      emailVerified: true,
      name: null,
    });
  });
});
