/**
 * Ошибка запроса, названная машинным кодом.
 *
 * `code` — единственное, что можно показывать человеку, и то через словарь.
 * `message` существует для журнала разработчика и намеренно не содержит ни
 * кода, ни тела ответа: иначе однажды его выведут в интерфейс как есть, и
 * азербайджанский читатель увидит `session_expired`.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  /**
   * Числа, которые сервер приложил к отказу заголовками.
   *
   * Их место именно в заголовках, а не в `detail`: тело отказа обязано
   * оставаться машинным кодом, который клиент переводит по словарю, и
   * подмешивать в него числа значило бы заставить клиент разбирать строку.
   */
  readonly hints: Record<string, number>;

  constructor(code: string, status: number, hints: Record<string, number> = {}) {
    super(`запрос завершился со статусом ${status}`);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.hints = hints;
  }
}

/**
 * Заголовки, из которых читаются числовые подсказки, и имена, под которыми
 * они ложатся в `hints`.
 *
 * Список явный, а не «возьмём всё, что похоже на число»: иначе случайный
 * заголовок промежуточного прокси однажды превратился бы в подсказку, на
 * которую опирается интерфейс.
 */
const NUMERIC_HINT_HEADERS: Record<string, string> = {
  "x-shift-deviation-days": "deviationDays",
  "x-shift-threshold-days": "thresholdDays",
};

function hintsFrom(headers: Headers): Record<string, number> {
  const hints: Record<string, number> = {};
  for (const [header, name] of Object.entries(NUMERIC_HINT_HEADERS)) {
    const raw = headers.get(header);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) hints[name] = value;
  }
  return hints;
}

/** Код, под которым в словаре лежит «сервер недоступен». */
export const NETWORK_ERROR_CODE = "network";

function codeFromBody(body: unknown): string {
  if (body === null || typeof body !== "object") return "unknown";
  const detail = (body as { detail?: unknown }).detail;

  // У FastAPI две формы ошибки. `detail` строкой — наш машинный код.
  if (typeof detail === "string" && detail !== "") return detail;

  // `detail` массивом — отбраковка схемы Pydantic. Её сворачиваем в один код:
  // показывать человеку английскую прозу Pydantic на азербайджанском
  // интерфейсе нельзя, а разбирать её по полям — задача не этого плана.
  if (Array.isArray(detail)) return "validation_error";

  return "unknown";
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      // Сессия живёт в HTTP-only куке: клиент её не читает, но обязан
      // отправлять — без этого каждый запрос выглядит анонимным.
      credentials: "include",
      ...init,
      headers: {
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch {
    // Сеть не ответила: сервер лежит, DNS не разрешился, кабель выдернут.
    // Отдельный код, потому что это единственная ошибка, которую человек
    // может починить сам.
    throw new ApiError(NETWORK_ERROR_CODE, 0);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(codeFromBody(body), response.status, hintsFrom(response.headers));
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
