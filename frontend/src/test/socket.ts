/**
 * Сокет, которым управляет тест.
 *
 * Ставится глобально для всего набора (см. setup.ts), и не ради удобства:
 * настоящий `WebSocket` из jsdom полез бы в сеть на каждом тесте, который
 * открывает экран проекта, — за ответом, которого никто не даёт. Тесты стали
 * бы зависеть от того, слушает ли что-нибудь порт под ними.
 *
 * Реализовано ровно то, чем пользуется useProjectLive: конструктор,
 * три обработчика, close(). Пустой класс-заглушка на месте платформенного
 * API — плохая идея вообще, но здесь поверхность известна и мала, а
 * альтернатива — реальная сеть в юнит-тестах.
 */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Все созданные за тест, в порядке создания: переподключение — новый экземпляр. */
  static instances: FakeWebSocket[] = [];

  readyState: number = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  /** Всё, что приложение отправило в сокет. Обязано остаться пустым: он слушающий. */
  readonly sent: string[] = [];

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  // --- то, чем сокет двигает тест -------------------------------------------

  /** Сервер принял подключение. */
  accept() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** Сервер прислал сообщение. */
  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** Связь оборвалась сама: вырванный кабель, уснувший сервер. */
  drop(code = 1006) {
    this.close(code);
  }
}

/** Последний открытый сокет. Их больше одного там, где было переподключение. */
export function lastSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("приложение не открыло ни одного сокета");
  return socket;
}

export function installFakeWebSocket() {
  FakeWebSocket.instances = [];
  // defineProperty, а не присваивание: jsdom объявляет WebSocket свойством
  // только для чтения, и простое присваивание падает.
  Object.defineProperty(globalThis, "WebSocket", {
    value: FakeWebSocket,
    configurable: true,
    writable: true,
  });
}
