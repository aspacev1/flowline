# План 2: заведение проекта и задач — план реализации

> **Historical.** This is one of the original build plans this codebase
> was built from — every step below has since shipped. It reflects the plan
> as scoped in August 2026, not necessarily today's implementation; for
> current architecture and conventions, see the repo's `CLAUDE.md` and the
> `planora-conventions` skill. Kept as a build-history record, not an active
> task list.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести интерфейс до состояния, в котором человек создаёт проект, заводит категории и задачи и видит их на настоящей диаграмме Ганта с дневной шкалой — пока без перетаскивания и правки.

**Architecture:** Диаграмма — единственный нетривиальный компонент, и он разбивается на части с ясными границами: шкала времени переводит даты в пиксели и обратно, строки рисуют содержимое, оболочка отвечает за прокрутку и закреплённую левую колонку. Все данные приходят одним запросом состояния проекта; все изменения уходят операциями. Клиент не считает даты окончания — их считает сервер и присылает готовыми.

**Tech Stack:** Как в плане 1: Vite, React, TypeScript, react-router, TanStack Query, Vitest, Testing Library, MSW, свой CSS.

## Global Constraints

- Даты окончания приходят с сервера. Клиент не воспроизводит календарную арифметику ни при каких обстоятельствах: правила рабочих дней живут в одном месте, и это не браузер.
- Все изменения данных проекта идут операциями через `POST /api/projects/{id}/mutations`. Прямых обновлений сущностей нет.
- Публичный контракт операции не принимает поля восстановления (`task_id`, `category_id` при создании, `position`). Их назначает сервер.
- Языки: `az` по умолчанию, `en`, `ru`. Чрома переводится, содержимое пользователя — никогда.
- Сервер отвечает машинными кодами; клиент переводит код в текст и никогда не показывает `detail` как есть.
- Нерабочие дни приходят в состоянии проекта и заливаются фоном по всей высоте диаграммы.
- Порядок строк рисуется по `(position, id)`: позиции могут совпасть в одном краевом случае, и без второго ключа порядок между перерисовками неустойчив.
- Свой CSS с переменными и тёмной темой через `prefers-color-scheme`.

---

### Task 1: Список проектов и создание проекта

**Files:**
- Modify: `frontend/src/screens/Projects.tsx`
- Create: `frontend/src/api/projects.ts`
- Create: `frontend/src/components/Modal.tsx`
- Test: `frontend/src/screens/Projects.test.tsx`

**Interfaces:**
- Produces: `listProjects()`, `createProject(name)`, `getProject(id)`, `applyOp(projectId, op, reason?)`; модальное окно многоразового пользования.

- [ ] **Step 1: Написать падающие тесты**

```tsx
it("создаёт проект и уводит на него", async () => {
  server.use(
    http.get("/api/projects", () => HttpResponse.json([])),
    http.post("/api/projects", async ({ request }) => {
      expect(await request.json()).toEqual({ name: "Редизайн сайта" });
      return HttpResponse.json({ id: "p1", name: "Редизайн сайта", slug: "redizayn-sayta" },
        { status: 201 });
    }),
  );

  renderApp({ route: "/projects", locale: "ru" });
  await userEvent.click(await screen.findByRole("button", { name: /создать проект/i }));
  await userEvent.type(screen.getByLabelText(/название/i), "Редизайн сайта");
  await userEvent.click(screen.getByRole("button", { name: /создать$/i }));

  await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/projects/p1"));
});

it("показывает слаг, который сервер выдал, а не выдуманный клиентом", async () => {
  server.use(
    http.get("/api/projects", () => HttpResponse.json([
      { id: "p1", name: "Şəhər Layihəsi", slug: "seher-layihesi" }])),
  );

  renderApp({ route: "/projects", locale: "ru" });

  expect(await screen.findByText("seher-layihesi")).toBeInTheDocument();
});

it("не даёт отправить пустое название", async () => {
  server.use(http.get("/api/projects", () => HttpResponse.json([])));

  renderApp({ route: "/projects", locale: "ru" });
  await userEvent.click(await screen.findByRole("button", { name: /создать проект/i }));

  expect(screen.getByRole("button", { name: /создать$/i })).toBeDisabled();
});

it("объясняет отказ сервера переведённым текстом", async () => {
  server.use(
    http.get("/api/projects", () => HttpResponse.json([])),
    http.post("/api/projects", () =>
      HttpResponse.json({ detail: "forbidden" }, { status: 403 })),
  );

  renderApp({ route: "/projects", locale: "ru" });
  await createProjectNamed("Тест");

  expect(await screen.findByText(/недостаточно прав/i)).toBeInTheDocument();
});
```

Второй тест закрепляет правило, которое легко нарушить из лучших побуждений: слаг строится по таблице транслитерации на сервере, и повторять эту логику в браузере нельзя — расхождение даст ссылку, которая не открывается.

- [ ] **Step 2: Запустить и убедиться, что падают**

```bash
cd frontend && npx vitest run src/screens/Projects.test.tsx
```

- [ ] **Step 3: Реализовать клиент проектов**

- [ ] **Step 4: Реализовать модальное окно**

Многоразовое: закрывается по Esc и по клику вне, возвращает фокус туда, откуда открылось, и ставит фокус на первое поле при открытии. Всё это нужно и для доступности, и для того, чтобы дальнейшие экраны не изобретали своё окно заново.

- [ ] **Step 5: Реализовать экран**

- [ ] **Step 6: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run
git add frontend/src/
git commit -m "feat: список проектов и создание проекта"
```

---

### Task 2: Шкала времени

**Files:**
- Create: `frontend/src/gantt/timescale.ts`
- Test: `frontend/src/gantt/timescale.test.ts`

**Interfaces:**
- Produces: `buildScale({from, to, dayWidth}) -> Scale`; у `Scale` — `days`, `months`, `width`, `xOf(date)`, `widthOf(startISO, endISO)`, `dateAt(x)`.

Чистый модуль без React. Он переводит даты в пиксели и обратно; всё остальное в диаграмме опирается на него. Отдельный модуль потому, что перетаскивание в плане 3 будет спрашивать `dateAt(x)`, и логика перевода должна быть проверена без участия DOM.

- [ ] **Step 1: Написать падающие тесты**

```ts
const scale = buildScale({ from: "2026-03-01", to: "2026-06-15", dayWidth: 26 });

it("ширина ленты равна числу дней на ширину дня", () => {
  expect(scale.days.length).toBe(107);
  expect(scale.width).toBe(107 * 26);
});

it("первый день начинается в нуле", () => {
  expect(scale.xOf("2026-03-01")).toBe(0);
});

it("ширина полоски включает оба конца", () => {
  // задача с 4 по 6 марта занимает три дня
  expect(scale.widthOf("2026-03-04", "2026-03-06")).toBe(3 * 26);
});

it("однодневная задача не схлопывается в ноль", () => {
  expect(scale.widthOf("2026-03-04", "2026-03-04")).toBe(26);
});

it("перевод пикселей в дату обратен переводу даты в пиксели", () => {
  for (const iso of ["2026-03-01", "2026-04-15", "2026-06-15"]) {
    expect(scale.dateAt(scale.xOf(iso))).toBe(iso);
  }
});

it("месяцы идут в порядке и покрывают всю ленту", () => {
  expect(scale.months.map((m) => m.key)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
  expect(scale.months.reduce((sum, m) => sum + m.days, 0)).toBe(scale.days.length);
});

it("день недели считается по календарю, а не по остатку от деления", () => {
  expect(scale.days[0].weekday).toBe(0); // 1 марта 2026 — воскресенье
});
```

Последний тест не формальность: вычислять день недели индексом от начала ленты — обычная ошибка, и она вылезает только при смене границ окна.

- [ ] **Step 2: Запустить и убедиться, что падают**

- [ ] **Step 3: Реализовать модуль**

Даты внутри — строки ISO, а не объекты `Date`: объект тянет за собой часовой пояс, и полоска, посчитанная в одном поясе, съезжает на день в другом. Арифметика идёт по UTC-полуночи, наружу отдаются те же строки, что пришли с сервера.

- [ ] **Step 4: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run src/gantt/timescale.test.ts
git add frontend/src/gantt/
git commit -m "feat: шкала времени диаграммы"
```

---

### Task 3: Диаграмма на чтение

**Files:**
- Create: `frontend/src/gantt/Gantt.tsx`, `Header.tsx`, `Row.tsx`, `Grid.tsx`
- Create: `frontend/src/gantt/gantt.css`
- Create: `frontend/src/screens/Project.tsx`
- Test: `frontend/src/gantt/Gantt.test.tsx`

**Interfaces:**
- Consumes: `buildScale`, состояние проекта из `getProject`.
- Produces: компонент `<Gantt state={...} />`, рисующий шапку, сетку, строки категорий и задач.

- [ ] **Step 1: Написать падающие тесты**

```tsx
const STATE = {
  id: "p1", name: "Редизайн", deadline: "2026-06-01", project_end: "2026-06-08",
  calendar: { working_days: 31, holidays: ["2026-03-20"], extra_workdays: [] },
  categories: [{ id: "c1", name: "Дизайн", color: "#3b82f6", position: 0 }],
  tasks: [{
    id: "t1", category_id: "c1", name: "Логотип", start_date: "2026-03-04",
    end_date: "2026-03-10", duration_days: 5, criticality: "high",
    progress_pct: 40, position: 0, assignee_ids: [],
  }],
  dependencies: [],
};

it("рисует задачу полоской нужной ширины", () => {
  render(<Gantt state={STATE} />);
  const bar = screen.getByRole("button", { name: /Логотип/ });
  // 4-10 марта — семь календарных дней
  expect(bar).toHaveStyle({ width: `${7 * 26}px` });
});

it("заливает выходные и праздники", () => {
  const { container } = render(<Gantt state={STATE} />);
  expect(container.querySelectorAll(".is-nonworking").length).toBeGreaterThan(0);
  expect(container.querySelector('[data-day="2026-03-20"]')).toHaveClass("is-nonworking");
});

it("красит задачу, заезжающую за дедлайн", () => {
  const late = { ...STATE, tasks: [{ ...STATE.tasks[0], end_date: "2026-06-05" }] };
  render(<Gantt state={late} />);
  expect(screen.getByRole("button", { name: /Логотип/ })).toHaveClass("is-late");
});

it("показывает итог по дедлайну на языке читателя", () => {
  renderWithLocale(<Gantt state={STATE} />, "ru");
  expect(screen.getByText(/на 7 дней позже/i)).toBeInTheDocument();
});

it("сортирует строки по позиции, а при равенстве — по идентификатору", () => {
  const tied = { ...STATE, tasks: [
    { ...STATE.tasks[0], id: "t2", name: "Вторая", position: 1 },
    { ...STATE.tasks[0], id: "t1", name: "Первая", position: 1 },
  ]};
  render(<Gantt state={tied} />);
  const names = screen.getAllByRole("button", { name: /Первая|Вторая/ }).map((n) => n.textContent);
  expect(names).toEqual(["Первая", "Вторая"]);
});

it("пустой проект объясняет, что делать", () => {
  renderWithLocale(<Gantt state={{ ...STATE, categories: [], tasks: [] }} />, "ru");
  expect(screen.getByText(/ни одной категории/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Запустить и убедиться, что падают**

- [ ] **Step 3: Реализовать шапку и сетку**

Шапка двухуровневая: месяцы сверху, дни снизу с числом и днём недели. Нерабочие дни заливаются и в шапке, и на всю высоту строк. Сетка строится один раз и переиспользуется всеми строками — на сотне задач сто одинаковых наборов из ста дней это десять тысяч узлов, и страница начинает тормозить.

- [ ] **Step 4: Реализовать строки и полоски**

Полоска — кнопка, а не `div`: по ней будут кликать и водить с клавиатуры, и это единственный способ получить доступность даром. Прогресс рисуется заливкой внутри полоски. Задача, заканчивающаяся позже дедлайна, красится и получает флажок в левой колонке.

- [ ] **Step 5: Реализовать оболочку с прокруткой**

Горизонтальная прокрутка с закреплённой левой колонкой (`position: sticky`). При открытии лента проматывается к сегодняшнему дню.

- [ ] **Step 6: Реализовать экран проекта**

Загрузка, ошибка и успех — три явных состояния. Ошибка 404 показывает «проект не найден», а не пустую диаграмму: чужой и несуществующий проект неразличимы, и интерфейс не должен делать вид, что знает разницу.

- [ ] **Step 7: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run src/gantt
git add frontend/src/gantt/ frontend/src/screens/Project.tsx
git commit -m "feat: диаграмма Ганта на чтение"
```

---

### Task 4: Создание категорий

**Files:**
- Create: `frontend/src/screens/CategoryForm.tsx`
- Modify: `frontend/src/screens/Project.tsx`
- Test: `frontend/src/screens/CategoryForm.test.tsx`

**Interfaces:**
- Produces: форма создания категории, отправляющая операцию `create_category`.

- [ ] **Step 1: Написать падающие тесты**

```tsx
it("отправляет операцию создания категории и обновляет диаграмму", async () => {
  const sent: unknown[] = [];
  server.use(
    http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
    http.post("/api/projects/p1/mutations", async ({ request }) => {
      sent.push(await request.json());
      return HttpResponse.json({ seq: 2, op: {}, inverse: {} }, { status: 201 });
    }),
  );

  renderApp({ route: "/projects/p1", locale: "ru" });
  await userEvent.click(await screen.findByRole("button", { name: /категория/i }));
  await userEvent.type(screen.getByLabelText(/название/i), "Аналитика");
  await userEvent.click(screen.getByRole("button", { name: /создать$/i }));

  await waitFor(() => expect(sent).toEqual([{ op: {
    type: "create_category", name: "Аналитика", color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
  }}]));
});

it("не шлёт в операции полей, которых нет в публичном контракте", async () => {
  // position и category_id назначает сервер; клиент их не знает и знать не должен
  const sent: any[] = [];
  server.use(
    http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
    http.post("/api/projects/p1/mutations", async ({ request }) => {
      sent.push(await request.json());
      return HttpResponse.json({ seq: 2, op: {}, inverse: {} }, { status: 201 });
    }),
  );

  renderApp({ route: "/projects/p1", locale: "ru" });
  await createCategoryNamed("Аналитика");

  expect(sent[0].op).not.toHaveProperty("position");
  expect(sent[0].op).not.toHaveProperty("category_id");
});
```

- [ ] **Step 2: Запустить и убедиться, что падают**

- [ ] **Step 3: Реализовать форму**

Цвет предлагается из палитры по числу уже существующих категорий, но выбирается человеком. После успеха состояние проекта перезапрашивается — не дописывается руками в кэш: сервер мог назначить позицию не так, как ожидает клиент, и расхождение вылезет позже в самом неудобном месте.

- [ ] **Step 4: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run src/screens/CategoryForm.test.tsx
git add frontend/src/screens/
git commit -m "feat: создание категорий"
```

---

### Task 5: Создание задач

**Files:**
- Create: `frontend/src/screens/TaskForm.tsx`
- Modify: `frontend/src/gantt/Row.tsx`
- Test: `frontend/src/screens/TaskForm.test.tsx`

**Interfaces:**
- Produces: форма создания задачи с полями названия, описания, категории, критичности, даты старта, длительности и исполнителей.

- [ ] **Step 1: Написать падающие тесты**

```tsx
it("подставляет категорию, из строки которой открыли форму", async () => {
  server.use(
    http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
    http.get("/api/org/members", () => HttpResponse.json(MEMBERS)),
  );

  renderApp({ route: "/projects/p1", locale: "ru" });
  await userEvent.click(await screen.findByRole("button", { name: /добавить задачу в «Дизайн»/i }));

  expect(screen.getByLabelText(/категория/i)).toHaveValue("c1");
});

it("отправляет операцию с длительностью в рабочих днях", async () => {
  const sent: any[] = [];
  server.use(
    http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
    http.get("/api/org/members", () => HttpResponse.json(MEMBERS)),
    http.post("/api/projects/p1/mutations", async ({ request }) => {
      sent.push(await request.json());
      return HttpResponse.json({ seq: 3, op: {}, inverse: {} }, { status: 201 });
    }),
  );

  renderApp({ route: "/projects/p1", locale: "ru" });
  await fillTaskForm({ name: "Макеты", start: "2026-03-19", days: 14 });

  expect(sent[0].op).toMatchObject({
    type: "create_task", category_id: "c1", name: "Макеты",
    start_date: "2026-03-19", duration_days: 14,
  });
});

it("переводит отказ сервера по коду, а не показывает detail", async () => {
  server.use(
    http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
    http.get("/api/org/members", () => HttpResponse.json(MEMBERS)),
    http.post("/api/projects/p1/mutations", () =>
      HttpResponse.json({ detail: "too_many_tasks" }, { status: 422 })),
  );

  renderApp({ route: "/projects/p1", locale: "ru" });
  await fillTaskForm({ name: "Макеты", start: "2026-03-19", days: 14 });

  expect(await screen.findByText(/слишком много задач/i)).toBeInTheDocument();
  expect(screen.queryByText("too_many_tasks")).not.toBeInTheDocument();
});

it("не даёт длительность меньше одного дня", async () => {
  server.use(
    http.get("/api/projects/p1", () => HttpResponse.json(STATE)),
    http.get("/api/org/members", () => HttpResponse.json(MEMBERS)),
  );

  renderApp({ route: "/projects/p1", locale: "ru" });
  await openTaskForm();
  await userEvent.clear(screen.getByLabelText(/рабочих дней/i));
  await userEvent.type(screen.getByLabelText(/рабочих дней/i), "0");

  expect(screen.getByRole("button", { name: /создать задачу/i })).toBeDisabled();
});
```

- [ ] **Step 2: Запустить и убедиться, что падают**

- [ ] **Step 3: Реализовать выбор исполнителей**

Список приходит из `GET /api/org/members`. Роль `client` этот маршрут не получает вовсе, поэтому при отказе 403 блок исполнителей просто не показывается — а не ломает форму.

- [ ] **Step 4: Реализовать форму и точку входа**

Плюс на строке категории открывает форму с уже подставленной категорией. Подпись кнопки включает название категории, иначе на десятке категорий все плюсы неразличимы для чтения с экрана.

Поле длительности подписано «рабочих дней», а не «дней»: это разные вещи, и человек, поставивший 5 в пятницу, должен понимать, почему задача кончается в четверг.

- [ ] **Step 5: Прогнать весь набор и собрать**

```bash
cd frontend && npx vitest run && npm run build
```

- [ ] **Step 6: Проверить вживую**

Против настоящего бэкенда: создать проект, две категории, три задачи с разными длительностями и критичностью. Убедиться, что даты окончания совпадают с тем, что показывает `GET /api/projects/{id}` — и что задача, начатая в пятницу, перепрыгивает выходные.

- [ ] **Step 7: Закоммитить**

```bash
git add frontend/
git commit -m "feat: создание задач"
```

---

## Что этот план не делает

- Перетаскивание, правку на месте, карточку задачи, историю и анимацию — план 3.
- Стрелки связей рисуются планом 3 вместе с остальной интерактивностью; в этом плане `dependencies` приходят в состоянии, но не отображаются.
- Утверждение плана, базовый план и порог с причиной — следующий план после фронтового цикла. Поля в состоянии уже есть и игнорируются.
- Редактирование настроек проекта: дедлайн, календарь, порог. Отображаются, но не меняются.
