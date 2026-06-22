import { describe, it, expect, vi, beforeEach } from "vitest";

describe("mailer", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  });

  it("isMailerConfigured returns false when SMTP env vars are missing", async () => {
    const { isMailerConfigured } = await import("../mailer.js");
    expect(isMailerConfigured()).toBe(false);
  });

  it("isMailerConfigured returns true when all SMTP env vars are set", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.SMTP_FROM = "noreply@example.com";
    const { isMailerConfigured } = await import("../mailer.js");
    expect(isMailerConfigured()).toBe(true);
  });

  it("sendMail calls the injected transport with from/to/subject/html", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.SMTP_FROM = "noreply@example.com";
    const { sendMail } = await import("../mailer.js");
    const fakeTransport = { sendMail: vi.fn().mockResolvedValue({ messageId: "1" }) };

    await sendMail(
      { to: "person@example.com", subject: "Hi", html: "<p>Hi</p>" },
      fakeTransport
    );

    expect(fakeTransport.sendMail).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "person@example.com",
      subject: "Hi",
      html: "<p>Hi</p>",
    });
  });
});
