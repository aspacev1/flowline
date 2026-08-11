import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../test/server";
import { me, register } from "./auth";

describe("клиент API", () => {
  it("превращает detail сервера в код ошибки, а не в текст для показа", async () => {
    server.use(
      http.post("/api/auth/register", () =>
        HttpResponse.json({ detail: "email_taken" }, { status: 409 }),
      ),
    );

    await expect(
      register({ name: "A", email: "a@b.c", password: "s3cret-pass" }),
    ).rejects.toMatchObject({ code: "email_taken", status: 409 });
  });

  it("отдаёт код валидации FastAPI отдельным классом", async () => {
    server.use(
      http.post("/api/auth/register", () =>
        HttpResponse.json({ detail: [{ loc: ["body", "password"], msg: "too short" }] }, {
          status: 422,
        }),
      ),
    );

    await expect(register({ name: "A", email: "a@b.c", password: "short" })).rejects.toMatchObject({
      code: "validation_error",
    });
  });

  it("не подставляет тело в сообщение пользователю", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ detail: "session_expired" }, { status: 401 }),
      ),
    );

    const error = await me().catch((e) => e);
    expect(error.code).toBe("session_expired");
    expect(error.message).not.toContain("session_expired");
  });

  it("недоступный сервер — тоже код, а не молчание", async () => {
    server.use(http.get("/api/auth/me", () => HttpResponse.error()));

    await expect(me()).rejects.toMatchObject({ code: "network" });
  });
});
