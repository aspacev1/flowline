import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "../test/server";
import { renderWithProviders } from "../test/utils";
import { Register } from "./Register";

// Единственное, что здесь подменяется, — переход роутера: сам факт «увёл
// внутрь» иначе не наблюдаем в изоляции экрана. Сеть остаётся настоящей и
// перехватывается MSW.
const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateSpy };
});

beforeEach(() => {
  navigateSpy.mockClear();
});

async function fillAndSubmit() {
  // Заякорено на весь текст подписи: «Şirkətin adı» и «Company name» тоже
  // содержат «ad»/«name» кусками, а этому полю нужно ровно имя человека.
  await userEvent.type(screen.getByLabelText(/^(ad|name|имя)$/i), "Алексей");
  await userEvent.type(screen.getByLabelText(/şirkət|company|компани/i), "Acme");
  await userEvent.type(screen.getByLabelText(/e-?poçt|email|почта/i), "a@b.c");
  await userEvent.type(screen.getByLabelText(/parol|password|пароль/i), "s3cret-pass");
  await userEvent.click(screen.getByRole("button", { name: /qeydiyyat|register|зарегистр/i }));
}

describe("экран регистрации", () => {
  it("регистрирует и уводит внутрь", async () => {
    server.use(
      http.post("/api/auth/register", () =>
        HttpResponse.json({ id: "u1", name: "Алексей", email: "a@b.c", locale: "az" }, {
          status: 201,
        }),
      ),
    );

    renderWithProviders(<Register />);
    await fillAndSubmit();

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/projects"));
  });

  it("показывает занятый адрес переведённым текстом, а не кодом", async () => {
    server.use(
      http.post("/api/auth/register", () =>
        HttpResponse.json({ detail: "email_taken" }, { status: 409 }),
      ),
    );

    renderWithProviders(<Register />, { locale: "ru" });
    await fillAndSubmit();

    expect(await screen.findByText("Этот адрес уже занят")).toBeInTheDocument();
    expect(screen.queryByText("email_taken")).not.toBeInTheDocument();
  });

  it("отправляет название компании вместе с остальной формой", async () => {
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.post("/api/auth/register", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { id: "u1", name: "Алексей", email: "a@b.c", locale: "az" },
          { status: 201 },
        );
      }),
    );

    renderWithProviders(<Register />);
    await fillAndSubmit();

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/projects"));
    expect(sent).toMatchObject({ company_name: "Acme" });
  });

  it("показывает пустое название компании переведённым текстом, а не кодом", async () => {
    server.use(
      http.post("/api/auth/register", () =>
        HttpResponse.json({ detail: "company_name_required" }, { status: 422 }),
      ),
    );

    renderWithProviders(<Register />, { locale: "ru" });
    await fillAndSubmit();

    expect(await screen.findByText("Укажите название компании")).toBeInTheDocument();
    expect(screen.queryByText("company_name_required")).not.toBeInTheDocument();
  });

  it("не отправляет форму с коротким паролем и объясняет почему", async () => {
    renderWithProviders(<Register />, { locale: "ru" });
    await userEvent.type(screen.getByLabelText(/пароль/i), "short");
    await userEvent.click(screen.getByRole("button", { name: /зарегистр/i }));

    expect(await screen.findByText(/не короче 8/i)).toBeInTheDocument();
  });

  it("сообщает о недоступности сервера, а не молчит", async () => {
    server.use(http.post("/api/auth/register", () => HttpResponse.error()));

    renderWithProviders(<Register />, { locale: "ru" });
    await fillAndSubmit();

    expect(await screen.findByText(/сервер недоступен/i)).toBeInTheDocument();
  });

  it("не даёт нажать кнопку дважды, пока запрос в пути", async () => {
    // Ответ не приходит никогда: только так «пока запрос в пути» вообще
    // наблюдаемо — мгновенный ответ закрывает это состояние раньше проверки.
    server.use(http.post("/api/auth/register", () => delay("infinite")));

    renderWithProviders(<Register />, { locale: "ru" });
    await fillAndSubmit();

    await waitFor(() => expect(screen.getByRole("button", { name: /зарегистр/i })).toBeDisabled());
  });
});
