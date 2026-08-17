import { request } from "./client";

/** Ключ кэша профиля: один на всё приложение, иначе состояний входа станет два. */
export const ME_QUERY_KEY = ["auth", "me"] as const;

export type User = {
  id: string;
  name: string;
  email: string;
  locale: string;
  /**
   * Часовой пояс, по которому этому человеку считаются сутки. `null` —
   * «спросить у браузера»: пояс меняется вместе с человеком, и записанный
   * однажды при заведении аккаунта врал бы после первой же поездки.
   */
  timezone: string | null;
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
 * браузер. То же и с часовым поясом — с одной добавкой: `null` в нём
 * означает «считать сутки по браузеру», и поэтому поле уходит на сервер
 * ровно тогда, когда его назвали, а не когда оно непустое.
 */
export function updateProfile(patch: {
  name?: string;
  locale?: string;
  timezone?: string | null;
}): Promise<User> {
  return request<User>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
/**
 * Погашение ссылки из письма. Куки не требует: почту читают в другом месте.
 *
 * `already_verified` — ссылку открыли не в первый раз. Это не отказ: адрес
 * подтверждён, и человеку остаётся только выбрать слова — «подтверждён» или
 * «уже подтверждён».
 */
export function verifyEmail(token: string): Promise<{ already_verified: boolean }> {
  return request<{ already_verified: boolean }>("/api/auth/verify-email", {
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

/**
 * Просьба о письме для восстановления пароля. Ответ одинаковый для любого
 * адреса: есть ли такой аккаунт, сервер не сообщает — и экран не должен
 * обещать письмо, а только «если адрес зарегистрирован».
 */
export function requestPasswordReset(email: string): Promise<void> {
  return request<void>("/api/auth/password/forgot", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Погашение ссылки из письма: новый пароль вместо забытого. Куки не требует. */
export function resetPassword(input: { token: string; new_password: string }): Promise<void> {
  return request<void>("/api/auth/password/reset", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
