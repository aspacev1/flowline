import { describe, it, expect, beforeEach } from "vitest";

describe("oauth registry", () => {
  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    delete process.env.APPLE_CLIENT_ID;
    delete process.env.APPLE_TEAM_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_PRIVATE_KEY;
  });

  it("reports no providers enabled when no env vars are set", async () => {
    const { listEnabledProviders } = await import("../registry.js");
    expect(listEnabledProviders()).toEqual([]);
  });

  it("reports google enabled when both google env vars are set", async () => {
    process.env.GOOGLE_CLIENT_ID = "x";
    process.env.GOOGLE_CLIENT_SECRET = "y";
    const { listEnabledProviders } = await import("../registry.js");
    expect(listEnabledProviders()).toEqual(["google"]);
  });

  it("getProviderModule returns the google module by name", async () => {
    const { getProviderModule } = await import("../registry.js");
    const mod = await getProviderModule("google");
    expect(typeof mod.getAuthUrl).toBe("function");
    expect(typeof mod.exchangeCode).toBe("function");
  });

  it("getProviderModule throws for an unknown provider", async () => {
    const { getProviderModule } = await import("../registry.js");
    await expect(getProviderModule("facebook")).rejects.toThrow();
  });
});
