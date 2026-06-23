import { describe, it, expect, vi, beforeEach } from "vitest";

describe("microsoft oauth module", () => {
  beforeEach(() => {
    process.env.MICROSOFT_CLIENT_ID = "ms-client-id";
    process.env.MICROSOFT_CLIENT_SECRET = "ms-client-secret";
    process.env.OAUTH_REDIRECT_BASE_URL = "http://localhost:8080";
  });

  it("getAuthUrl builds a Microsoft authorization URL", async () => {
    const { getAuthUrl } = await import("../microsoft.js");
    const url = getAuthUrl("state-value");
    expect(url).toContain("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url).toContain("client_id=ms-client-id");
    expect(url).toContain("state=state-value");
  });

  it("exchangeCode returns normalized profile fields", async () => {
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "ms-user-1",
          mail: "person@example.com",
          displayName: "Person Example",
        }),
      });
    const { exchangeCode } = await import("../microsoft.js");
    const profile = await exchangeCode("code", fakeFetch);
    expect(profile).toEqual({
      providerUserId: "ms-user-1",
      email: "person@example.com",
      emailVerified: true,
      name: "Person Example",
    });
  });
});
