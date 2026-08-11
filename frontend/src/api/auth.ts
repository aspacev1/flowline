import { request } from "./client";

/** Ключ кэша профиля: один на всё приложение, иначе состояний входа станет два. */
export const ME_QUERY_KEY = ["auth", "me"] as const;

export type User = {
  id: string;
  name: string;
  email: string;
  locale: string;
  /** Подтверждён ли адрес. В установке без почты пустой у всех и ничего не
      запрещает — это признак для подсказки, а не для доступа. */
  email_verified: boolean;
};

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
  /**
   * Приглашение, по которому человек пришёл. С ним аккаунт заводится сразу
   * внутри позвавшей организации — и заводится даже там, где свободная
   * регистрация выключена.
   */
  invite_token?: string;
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
/** Погашение ссылки из письма. Куки не требует: почту читают в другом месте. */
export function verifyEmail(token: string): Promise<void> {
  return request<void>("/api/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

/**
 * Повторное письмо. Ответ говорит правду о доставке: `sent: false` — письмо
 * не ушло, и обещать «проверьте почту» в этом случае нельзя.
 */
export function resendVerification(): Promise<{ sent: boolean }> {
  return request<{ sent: boolean }>("/api/auth/verify-email/resend", { method: "POST" });
}
