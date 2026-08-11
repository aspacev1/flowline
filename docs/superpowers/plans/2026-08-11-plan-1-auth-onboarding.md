# План 1: регистрация и онбординг — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять фронтенд до состояния, в котором человек открывает адрес в браузере, регистрируется, попадает внутрь на своём языке и видит осмысленное пустое состояние — вместо `{"detail":"Not Found"}`.

**Architecture:** Vite + React + TypeScript, собираемый в статику, которую в бою отдаёт Caddy, а в разработке — dev-сервер Vite с проксированием `/api` на бэкенд. Интерфейс тонкий: он рисует состояние, отправляет запросы и переводит машинные коды ошибок в текст на языке читателя. Никаких расчётов дат и никаких решений о доступе на клиенте — и то и другое живёт на сервере.

**Tech Stack:** Vite, React, TypeScript, react-router, TanStack Query, Vitest, Testing Library, MSW. Свой CSS с переменными, без библиотеки компонентов.

## Global Constraints

- Языки: `az` (по умолчанию), `en`, `ru`. Один JSON-словарь на язык, ключи смысловые (`auth.email_taken`), а не фразы на каком-либо языке.
- Отсутствующий ключ падает на азербайджанский и пишет предупреждение в консоль, а не показывает пустоту.
- Русские числительные требуют настоящих правил множественного числа. Используется `Intl.PluralRules`, а не «если 1 то день иначе дней».
- Содержимое пользователя не переводится никогда. Переводится только интерфейс.
- Приведение регистра — только инвариантное: `toLowerCase`, никогда `toLocaleLowerCase`. В азербайджанской локали `I` превращается в `ı`, и всё, что опирается на регистр, начинает вести себя по-разному у разных людей.
- Сервер отвечает машинными кодами в `detail`. Клиент переводит код в текст; показывать пользователю сырой `detail` запрещено.
- Сессия живёт в HTTP-only куке. Клиент не читает и не хранит токен — он вообще не знает, что тот существует.
- Тесты бьют по перехваченной сети (MSW), а не по замоканным функциям приложения.
- Свой CSS с переменными и поддержкой тёмной темы через `prefers-color-scheme`.

---

### Task 1: Каркас фронтенда и тестовая оснастка

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`
- Create: `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`
- Create: `frontend/src/styles.css`
- Create: `frontend/src/test/setup.ts`, `frontend/src/test/server.ts`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Produces: собираемое приложение; `npm test` прогоняет Vitest; dev-сервер проксирует `/api` на `http://localhost:8000`.

- [ ] **Step 1: Создать проект**

```bash
cd /Users/me/Desktop/flowline && npm create vite@latest frontend -- --template react-ts && cd frontend && npm install && npm install react-router-dom @tanstack/react-query && npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom msw
```

- [ ] **Step 2: Написать падающий тест**

Создать `frontend/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("рисует каркас приложения", () => {
    render(<App />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Запустить и убедиться, что падает**

```bash
cd frontend && npx vitest run src/App.test.tsx
```

Ожидается: не найден модуль `./App` либо не настроен Vitest.

- [ ] **Step 4: Настроить Vite и Vitest**

`frontend/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // В разработке фронт и бэк живут на разных портах. Прокси избавляет от CORS
  // и заодно делает куку сессии однодоменной — иначе браузер её не сохранит.
  server: { proxy: { "/api": "http://localhost:8000" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
```

`frontend/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`onUnhandledRequest: "error"` выбран сознательно: запрос, который тест не описал, обязан ронять тест, а не молча уходить в никуда.

`frontend/src/test/server.ts`:

```ts
import { setupServer } from "msw/node";

export const server = setupServer();
```

- [ ] **Step 5: Написать каркас**

`frontend/src/App.tsx` — пока только разметка с `<main>`; маршрутизация появится в задаче 5.

- [ ] **Step 6: Прогнать тест**

```bash
cd frontend && npx vitest run
```

Ожидается: 1 passed.

- [ ] **Step 7: Убедиться, что сборка проходит**

```bash
cd frontend && npm run build
```

- [ ] **Step 8: Закоммитить**

```bash
git add frontend/
git commit -m "feat: каркас фронтенда, прокси на бэкенд, тестовая оснастка"
```

---

### Task 2: Языки

**Files:**
- Create: `frontend/src/i18n/az.json`, `en.json`, `ru.json`
- Create: `frontend/src/i18n/index.ts`
- Test: `frontend/src/i18n/i18n.test.ts`

**Interfaces:**
- Produces: `t(key, params?) -> string`, `useLocale()`, `LocaleProvider`, `SUPPORTED_LOCALES`.

- [ ] **Step 1: Написать падающие тесты**

```ts
import { describe, expect, it } from "vitest";

import { translate } from "./index";

describe("переводы", () => {
  it("подставляет параметры", () => {
    expect(translate("ru", "auth.greeting", { name: "Алексей" })).toBe("Привет, Алексей");
  });

  it("склоняет русские числительные по настоящим правилам", () => {
    expect(translate("ru", "common.days", { count: 1 })).toBe("1 день");
    expect(translate("ru", "common.days", { count: 3 })).toBe("3 дня");
    expect(translate("ru", "common.days", { count: 5 })).toBe("5 дней");
    expect(translate("ru", "common.days", { count: 21 })).toBe("21 день");
    expect(translate("ru", "common.days", { count: 112 })).toBe("112 дней");
  });

  it("падает на азербайджанский, если ключа нет", () => {
    expect(translate("en", "missing.key.for.test")).toBe(translate("az", "missing.key.for.test"));
  });

  it("возвращает сам ключ, если его нет нигде", () => {
    expect(translate("en", "totally.unknown")).toBe("totally.unknown");
  });
});

describe("полнота словарей", () => {
  it("во всех языках один и тот же набор ключей", async () => {
    const [az, en, ru] = await Promise.all([
      import("./az.json"), import("./en.json"), import("./ru.json"),
    ]);
    const keys = (o: object) => Object.keys(flatten(o)).sort();
    expect(keys(en.default)).toEqual(keys(az.default));
    expect(keys(ru.default)).toEqual(keys(az.default));
  });
});
```

Последний тест — тот самый, который спек требует держать в тестах, а не в глазах: без него рассинхрон словарей копится незаметно.

- [ ] **Step 2: Запустить и убедиться, что падают**

- [ ] **Step 3: Реализовать модуль**

Ключевое место — множественное число. Строка с числом хранится в словаре объектом с формами, а выбор формы делает `Intl.PluralRules`:

```ts
const PLURAL_RULES: Record<Locale, Intl.PluralRules> = {
  az: new Intl.PluralRules("az"),
  en: new Intl.PluralRules("en"),
  ru: new Intl.PluralRules("ru"),
};

function pick(value: unknown, locale: Locale, params?: Params): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && params && typeof params.count === "number") {
    const form = PLURAL_RULES[locale].select(params.count);
    const forms = value as Record<string, string>;
    return forms[form] ?? forms.other;
  }
  return undefined;
}
```

В `ru.json` строка выглядит так, и это единственный честный способ: русский различает три формы, и «если 1 то день иначе дней» ошибается на 2, 3, 4, 22 и далее.

```json
{ "common": { "days": { "one": "{count} день", "few": "{count} дня", "many": "{count} дней" } } }
```

Отсутствующий ключ пишет `console.warn` и падает на азербайджанский.

- [ ] **Step 4: Наполнить словари строками, нужными этому плану**

Регистрация, вход, ошибки аутентификации, шапка, пустое состояние. Ключи смысловые: `auth.register.title`, `auth.error.email_taken`, `nav.logout`.

- [ ] **Step 5: Реализовать контекст языка**

`LocaleProvider` определяет язык при первом входе: берёт из профиля, если человек вошёл, иначе из `navigator.language`, если тот просит один из трёх поддерживаемых, иначе — азербайджанский. Выбор человека сохраняется и побеждает.

- [ ] **Step 6: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run
git add frontend/src/i18n/
git commit -m "feat: три языка со словарями и настоящими правилами числительных"
```

---

### Task 3: Клиент API и перевод ошибок

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/auth.ts`
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces: `request<T>(path, init?) -> Promise<T>`; класс `ApiError` с полем `code`; `register()`, `login()`, `logout()`, `me()`.

- [ ] **Step 1: Написать падающие тесты**

```ts
it("превращает detail сервера в код ошибки, а не в текст для показа", async () => {
  server.use(http.post("/api/auth/register", () =>
    HttpResponse.json({ detail: "email_taken" }, { status: 409 })));

  await expect(register({ name: "A", email: "a@b.c", password: "s3cret-pass" }))
    .rejects.toMatchObject({ code: "email_taken", status: 409 });
});

it("отдаёт код валидации FastAPI отдельным классом", async () => {
  server.use(http.post("/api/auth/register", () =>
    HttpResponse.json({ detail: [{ loc: ["body", "password"], msg: "too short" }] },
      { status: 422 })));

  await expect(register({ name: "A", email: "a@b.c", password: "short" }))
    .rejects.toMatchObject({ code: "validation_error" });
});

it("не подставляет тело в сообщение пользователю", async () => {
  server.use(http.get("/api/auth/me", () =>
    HttpResponse.json({ detail: "session_expired" }, { status: 401 })));

  const error = await me().catch((e) => e);
  expect(error.code).toBe("session_expired");
  expect(error.message).not.toContain("session_expired");
});
```

Третий тест закрепляет правило: `message` — для журнала разработчика, показывать человеку можно только перевод по коду.

- [ ] **Step 2: Запустить и убедиться, что падают**

- [ ] **Step 3: Реализовать клиент**

Все запросы идут с `credentials: "include"`, потому что сессия живёт в куке. У FastAPI две формы ошибки: `detail` строкой — это наш машинный код; `detail` массивом — это отбраковка схемы, её сворачиваем в единый код `validation_error`, потому что показывать человеку английскую прозу Pydantic на азербайджанском интерфейсе нельзя.

- [ ] **Step 4: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run src/api
git add frontend/src/api/
git commit -m "feat: клиент API с машинными кодами ошибок"
```

---

### Task 4: Экран регистрации

**Files:**
- Create: `frontend/src/screens/Register.tsx`
- Create: `frontend/src/components/Field.tsx`
- Test: `frontend/src/screens/Register.test.tsx`

**Interfaces:**
- Produces: экран с полями имени, почты и пароля; после успеха — переход в приложение.

- [ ] **Step 1: Написать падающие тесты**

```tsx
it("регистрирует и уводит внутрь", async () => {
  server.use(http.post("/api/auth/register", () =>
    HttpResponse.json({ id: "u1", name: "Алексей", email: "a@b.c", locale: "az" },
      { status: 201 })));

  renderWithProviders(<Register />);
  await userEvent.type(screen.getByLabelText(/ad|name|имя/i), "Алексей");
  await userEvent.type(screen.getByLabelText(/e-?poçt|email|почта/i), "a@b.c");
  await userEvent.type(screen.getByLabelText(/parol|password|пароль/i), "s3cret-pass");
  await userEvent.click(screen.getByRole("button", { name: /qeydiyyat|register|зарегистр/i }));

  await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/projects"));
});

it("показывает занятый адрес переведённым текстом, а не кодом", async () => {
  server.use(http.post("/api/auth/register", () =>
    HttpResponse.json({ detail: "email_taken" }, { status: 409 })));

  renderWithProviders(<Register />, { locale: "ru" });
  await fillAndSubmit();

  expect(await screen.findByText("Этот адрес уже занят")).toBeInTheDocument();
  expect(screen.queryByText("email_taken")).not.toBeInTheDocument();
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
```

- [ ] **Step 2: Запустить и убедиться, что падают**

- [ ] **Step 3: Реализовать экран**

Требования, которые легко упустить: у каждого поля настоящий `<label for>`, а не плейсхолдер вместо подписи — иначе экран недоступен для чтения с экрана и тесты выше не найдут поля. Кнопка блокируется на время запроса, чтобы двойной клик не создал двух попыток. Пароль проверяется на длину до отправки — сервер тоже проверит, но человеку не за чем ждать ответа ради очевидного.

- [ ] **Step 4: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run src/screens/Register.test.tsx
git add frontend/src/screens/Register.tsx frontend/src/components/Field.tsx frontend/src/screens/Register.test.tsx
git commit -m "feat: экран регистрации"
```

---

### Task 5: Вход, выход и защищённые маршруты

**Files:**
- Create: `frontend/src/screens/Login.tsx`
- Create: `frontend/src/auth/AuthProvider.tsx`
- Create: `frontend/src/auth/RequireAuth.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/auth/RequireAuth.test.tsx`, `frontend/src/screens/Login.test.tsx`

**Interfaces:**
- Produces: `useAuth() -> {user, status, login, logout}`; `RequireAuth` — обёртка маршрута; маршруты `/login`, `/register`, `/projects`.

- [ ] **Step 1: Написать падающие тесты**

```tsx
it("не пускает неаутентифицированного и уводит на вход", async () => {
  server.use(http.get("/api/auth/me", () =>
    HttpResponse.json({ detail: "not_authenticated" }, { status: 401 })));

  renderApp({ route: "/projects" });

  expect(await screen.findByRole("heading", { name: /giriş|log in|вход/i })).toBeInTheDocument();
});

it("не мигает экраном входа, пока проверяет сессию", async () => {
  let resolve: (r: Response) => void;
  server.use(http.get("/api/auth/me", () => new Promise((r) => { resolve = r; })));

  renderApp({ route: "/projects" });

  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /вход/i })).not.toBeInTheDocument();
});

it("выход возвращает на экран входа и забывает пользователя", async () => {
  server.use(
    http.get("/api/auth/me", () => HttpResponse.json(USER)),
    http.post("/api/auth/logout", () => new HttpResponse(null, { status: 204 })),
  );

  renderApp({ route: "/projects" });
  await userEvent.click(await screen.findByRole("button", { name: /çıxış|log out|выйти/i }));

  expect(await screen.findByRole("heading", { name: /вход/i })).toBeInTheDocument();
});
```

Второй тест важнее, чем кажется: без состояния «проверяю» человек при каждой перезагрузке видит вспышку экрана входа, хотя он давно вошёл.

- [ ] **Step 2: Запустить и убедиться, что падают**

- [ ] **Step 3: Реализовать провайдер аутентификации**

Три состояния, а не два: `checking`, `authenticated`, `anonymous`. Пока `checking` — маршрут показывает индикатор, а не решает.

- [ ] **Step 4: Реализовать экран входа и маршрутизацию**

- [ ] **Step 5: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run
git add frontend/src/auth/ frontend/src/screens/Login.tsx frontend/src/App.tsx
git commit -m "feat: вход, выход и защищённые маршруты"
```

---

### Task 6: Шапка, переключатель языка и пустое состояние

**Files:**
- Create: `frontend/src/components/Header.tsx`
- Create: `frontend/src/screens/Projects.tsx`
- Test: `frontend/src/components/Header.test.tsx`, `frontend/src/screens/Projects.test.tsx`

**Interfaces:**
- Produces: шапка с именем организации, переключателем языка и выходом; экран списка проектов с пустым состоянием.

Это конец онбординга: человек внутри, видит своё имя, может сменить язык и понимает, что делать дальше.

- [ ] **Step 1: Написать падающие тесты**

```tsx
it("переключение языка меняет интерфейс, но не данные", async () => {
  server.use(
    http.get("/api/auth/me", () => HttpResponse.json(USER)),
    http.get("/api/projects", () => HttpResponse.json([
      { id: "p1", name: "Şəhər Layihəsi", slug: "seher-layihesi" }])),
  );

  renderApp({ route: "/projects", locale: "ru" });
  expect(await screen.findByText("Проекты")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "AZ" }));

  expect(await screen.findByText("Layihələr")).toBeInTheDocument();
  // название проекта — содержимое пользователя, оно не переводится
  expect(screen.getByText("Şəhər Layihəsi")).toBeInTheDocument();
});

it("пустой список объясняет, что делать дальше", async () => {
  server.use(
    http.get("/api/auth/me", () => HttpResponse.json(USER)),
    http.get("/api/projects", () => HttpResponse.json([])),
  );

  renderApp({ route: "/projects", locale: "ru" });

  expect(await screen.findByText(/пока ни одного проекта/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /создать проект/i })).toBeInTheDocument();
});
```

Первый тест закрепляет главное правило языков разом: чрома переводится, содержимое — нет.

- [ ] **Step 2: Запустить и убедиться, что падают**

- [ ] **Step 3: Реализовать шапку и экран**

Кнопка «создать проект» на этом этапе ведёт в заглушку — сам мастер создания появится в плане 2. Но пустое состояние без кнопки было бы тупиком, поэтому кнопка есть.

- [ ] **Step 4: Оформление**

`frontend/src/styles.css`: переменные цветов и тёмная тема через `prefers-color-scheme`, как в прототипе. Переносить палитру прототипа целиком не нужно — берите только то, что использует этот план.

- [ ] **Step 5: Прогнать весь набор и собрать**

```bash
cd frontend && npx vitest run && npm run build
```

- [ ] **Step 6: Проверить вживую против настоящего бэкенда**

```bash
cd frontend && npm run dev
```

Пройти сценарий руками: зарегистрироваться, увидеть своё имя в шапке, переключить язык, выйти, войти обратно. Убедиться, что после перезагрузки страницы вход не слетает и экран входа не мигает.

- [ ] **Step 7: Закоммитить**

```bash
git add frontend/
git commit -m "feat: шапка, переключатель языка, пустое состояние проектов"
```

---

### Task 7: Отдача фронтенда из Caddy

**Files:**
- Create: `Caddyfile`
- Create: `frontend/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `README.md`

**Interfaces:**
- Produces: `docker compose up` отдаёт собранный интерфейс на корне и проксирует `/api` в бэкенд.

Пока фронт живёт только в dev-сервере, обещание «разворачивается одной командой» снова становится неполным — на корне по-прежнему 404.

- [ ] **Step 1: Написать Dockerfile сборки**

Многоступенчатый: собрать статику в образе с Node, положить результат в образ Caddy. Итоговый образ не содержит ни Node, ни исходников.

- [ ] **Step 2: Написать Caddyfile**

Корень отдаёт статику, `/api/*` проксируется в сервис `api`. Обязателен фолбэк на `index.html` для маршрутов приложения — без него перезагрузка страницы на `/projects` даст 404 от Caddy.

- [ ] **Step 3: Подключить сервис в compose и поднять**

```bash
docker compose up -d --build && curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/
```

Ожидается: 200, а не 404.

- [ ] **Step 4: Пройти живой сценарий через Caddy**

Открыть в браузере, зарегистрироваться, перезагрузить страницу на внутреннем маршруте и убедиться, что она открывается, а не отдаёт 404. Это проверка фолбэка, и её нельзя заменить curl'ом на корень.

- [ ] **Step 5: Обновить README**

Дописать раздел про адрес интерфейса и про то, что фронт и API живут за одним доменом.

- [ ] **Step 6: Закоммитить**

```bash
git add Caddyfile frontend/Dockerfile docker-compose.yml README.md
git commit -m "feat: интерфейс отдаётся из Caddy на корне"
```

---

## Что этот план не делает

- Создание проектов, категорий и задач — план 2. Кнопка в пустом состоянии ведёт в заглушку.
- Диаграмму — план 2.
- Перетаскивание, правку и карточку задачи — план 3.
- Восстановление пароля и подтверждение адреса — плана нет, придут вместе с почтой в плане приглашений.
- Экран настроек организации. Язык переключается в шапке; остальные настройки появятся, когда появится что настраивать.
