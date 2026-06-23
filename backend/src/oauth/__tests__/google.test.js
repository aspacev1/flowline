import { describe, it, expect, vi, beforeEach } from "vitest";

describe("google oauth module", () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.OAUTH_REDIRECT_BASE_URL = "http://localhost:8080";
  });

  it("getAuthUrl builds a Google authorization URL containing client_id, redirect_uri and state", async () => {
    const { getAuthUrl } = await import("../google.js");
    const url = getAuthUrl("the-state-value");
    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("client_id=client-id");
    expect(url).toContain("state=the-state-value");
    expect(url).toContain(encodeURIComponent("http://localhost:8080/api/auth/oauth/google/callback"));
  });

  it("exchangeCode posts the code and returns normalized profile fields", async () => {
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: "google-user-1",
          email: "person@example.com",
          email_verified: true,
          name: "Person Example",
        }),
      });

    const { exchangeCode } = await import("../google.js");
    const profile = await exchangeCode("auth-code", fakeFetch);

    expect(profile).toEqual({
      providerUserId: "google-user-1",
      email: "person@example.com",
      emailVerified: true,
      name: "Person Example",
    });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("exchangeCode throws if the token exchange response is not ok", async () => {
    const fakeFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 400 });
    const { exchangeCode } = await import("../google.js");
    await expect(exchangeCode("bad-code", fakeFetch)).rejects.toThrow();
  });
});
