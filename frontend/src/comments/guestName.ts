const STORAGE_KEY = "planora.guest_name";

/**
 * Имя гостя запоминается в браузере, а не на сервере: аккаунта у гостя нет,
 * и просить его назваться заново под каждой репликой — способ получить трёх
 * разных «Нигяр» в одной ленте.
 *
 * Приватный режим браузера умеет запрещать localStorage — там имя просто не
 * переживёт перезагрузку. Это не повод падать (см. LocaleProvider).
 */
export function storedGuestName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberGuestName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // см. storedGuestName()
  }
}
