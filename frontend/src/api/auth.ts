import { request } from "./client";

/** Ключ кэша профиля: один на всё приложение, иначе состояний входа станет два. */
export const ME_QUERY_KEY = ["auth", "me"] as const;

export type User = {
  id: string;
  name: string;
  email: string;
  locale: string;
};

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export function register(input: RegisterInput): Promise<User> {
  return request<User>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(input: LoginInput): Promise<User> {
  return request<User>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export function me(): Promise<User> {
  return request<User>("/api/auth/me");
}

/**
 * Правка своего профиля — четвёртый уровень настроек.
 *
 * Язык живёт здесь, а не только в памяти браузера: человек, вошедший с
 * другого компьютера, обязан увидеть тот же язык, а не тот, что просит чужой
 * браузер.
 */
export function updateProfile(patch: { name?: string; locale?: string }): Promise<User> {
  return request<User>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
