/**
 * Имя гостя, запомненное браузером.
 *
 * `localStorage`, а не кука: сервер имя не спрашивает — оно едет в теле
 * реплики, — и кука уезжала бы с каждым запросом впустую.
 *
 * Обращение обёрнуто в try: в приватном режиме некоторых браузеров и при
 * запрете сторонних данных сам доступ к `localStorage` бросает исключение, и
 * страница не должна из-за этого не открыться вовсе. Забытое имя — это лишний
 * вопрос гостю, а не поломка.
 */
const KEY = "flowline_guest_name";

export function rememberedGuestName(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberGuestName(name: string): void {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // Ничего: имя просто спросят ещё раз в следующий визит.
  }
}
