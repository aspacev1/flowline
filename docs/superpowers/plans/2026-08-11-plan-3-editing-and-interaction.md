# План 3: перетаскивание, редактирование, карточки, анимация — план реализации

> **Historical.** This is one of the original build plans this codebase
> was built from — every step below has since shipped. It reflects the plan
> as scoped in August 2026, not necessarily today's implementation; for
> current architecture and conventions, see the repo's `CLAUDE.md` and the
> `planora-conventions` skill. Kept as a build-history record, not an active
> task list.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить диаграмму из картинки в инструмент: полоски двигаются мышью, строки переставляются, карточка задачи редактируется на месте, история читается на языке читателя, изменения не дёргают экран.

**Architecture:** Все изменения проходят один путь — оптимистичное применение к локальному состоянию, отправка операции, откат при отказе сервера. Этот путь пишется один раз и переиспользуется всеми жестами; в противном случае каждый экран изобретает свой откат, и они расходятся. История задачи собирается из журнала ревизий: сервер присылает событие с параметрами, клиент подставляет их в строку своего языка.

**Tech Stack:** Как в планах 1 и 2. Никаких новых зависимостей: перетаскивание пишется на указательных событиях, анимация — на CSS-переходах.

## Global Constraints

- Даты окончания считает сервер. После любого изменения дат клиент берёт даты из ответа, а не пересчитывает их сам.
- Все изменения идут операциями. Публичный контракт не принимает `task_id` и `position` при создании — их назначает сервер.
- История хранится событием с параметрами и собирается в текст при показе, на языке читателя. Причина сдвига — текст пользователя, он не переводится.
- Горизонтальное перетаскивание полоски меняет даты, вертикальное перетаскивание строки за левую колонку меняет порядок. Одна вещь — один жест, иначе люди будут сбивать сроки, пытаясь переставить строку.
- Внутренняя заметка — единственное поле с ограниченной видимостью. Показывать её или нет, решает сервер: если её нет в ответе, блока нет в интерфейсе.
- Языки: `az` по умолчанию, `en`, `ru`. Числительные — через `Intl.PluralRules`.
- Анимация уважает `prefers-reduced-motion`: при включённой настройке переходы отключаются, а не ускоряются.
- Свой CSS с переменными и тёмной темой.

---

### Task 1: Оптимистичные изменения с откатом

**Files:**
- Create: `frontend/src/project/useProjectMutation.ts`
- Test: `frontend/src/project/useProjectMutation.test.tsx`

**Interfaces:**
- Produces: `useProjectMutation(projectId)` → `{ apply(op, optimistic, options?) }`, где `optimistic` — функция, преобразующая состояние локально до ответа сервера.

Это фундамент задач 2–5. Пишется первым и отдельно, потому что каждый последующий жест им пользуется, а тестировать откат через перетаскивание мышью — мучение.

- [x] **Step 1: Написать падающие тесты**

```tsx
it("показывает изменение до ответа сервера", async () => {
  let release: () => void;
  server.use(http.post("/api/projects/p1/mutations", () =>
    new Promise((r) => { release = () => r(HttpResponse.json(OK, { status: 201 })); })));

  const { result } = renderHook(() => useProjectMutation("p1"), { wrapper });
  act(() => { result.current.apply(MOVE_OP, moveTaskLocally); });

  expect(cachedState().tasks[0].start_date).toBe("2026-03-11");
  release!();
});

it("возвращает прежнее состояние, если сервер отказал", async () => {
  server.use(http.post("/api/projects/p1/mutations", () =>
    HttpResponse.json({ detail: "task_not_found" }, { status: 404 })));

  const { result } = renderHook(() => useProjectMutation("p1"), { wrapper });
  await act(async () => { await result.current.apply(MOVE_OP, moveTaskLocally).catch(() => {}); });

  expect(cachedState().tasks[0].start_date).toBe("2026-03-04");
});

it("берёт итоговые данные с сервера, а не оставляет оптимистичные", async () => {
  // сервер посчитал дату окончания по календарю — клиент обязан взять его версию
  server.use(
    http.post("/api/projects/p1/mutations", () => HttpResponse.json(OK, { status: 201 })),
    http.get("/api/projects/p1", () => HttpResponse.json({
      ...STATE, tasks: [{ ...STATE.tasks[0], start_date: "2026-03-11", end_date: "2026-03-17" }],
    })),
  );

  const { result } = renderHook(() => useProjectMutation("p1"), { wrapper });
  await act(async () => { await result.current.apply(MOVE_OP, moveTaskLocally); });

  await waitFor(() => expect(cachedState().tasks[0].end_date).toBe("2026-03-17"));
});

it("два изменения подряд откатываются каждое к своему состоянию", async () => {
  server.use(
    http.post("/api/projects/p1/mutations", () => HttpResponse.json(OK, { status: 201 })),
  );
  const { result } = renderHook(() => useProjectMutation("p1"), { wrapper });

  await act(async () => { await result.current.apply(MOVE_OP, moveTaskLocally); });

  server.use(http.post("/api/projects/p1/mutations", () =>
    HttpResponse.json({ detail: "task_not_found" }, { status: 404 })));
  await act(async () => { await result.current.apply(MOVE_OP_2, moveTaskLocally2).catch(() => {}); });

  // откат второго не должен отменить первое
  expect(cachedState().tasks[0].start_date).toBe("2026-03-11");
});
```

Последний тест ловит классическую ошибку: снимок для отката делают один раз при монтировании, и откат второго изменения возвращает состояние к самому началу, стирая первое.

- [x] **Step 2: Запустить и убедиться, что падают**

- [x] **Step 3: Реализовать**

Снимок берётся **непосредственно перед каждым применением**, а не заранее. После успеха состояние проекта перезапрашивается: сервер мог посчитать дату окончания иначе, чем предположил клиент, и его версия единственно верная.

- [x] **Step 4: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run src/project
git add frontend/src/project/
git commit -m "feat: оптимистичные изменения с честным откатом"
```

---

### Task 2: Карточка задачи

**Files:**
- Create: `frontend/src/task/TaskPanel.tsx`
- Modify: `frontend/src/gantt/Gantt.tsx`
- Test: `frontend/src/task/TaskPanel.test.tsx`

**Interfaces:**
- Produces: панель задачи, открывающаяся по клику и закрывающаяся крестиком, клавишей Esc и повторным кликом по той же задаче.

- [x] **Step 1: Написать падающие тесты**

```tsx
it("по умолчанию скрыта, открывается кликом по задаче", async () => {
  renderProject();
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

  await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
  expect(screen.getByRole("complementary")).toBeInTheDocument();
});

it("закрывается по Esc, крестиком и повторным кликом по той же задаче", async () => {
  renderProject();
  const bar = await screen.findByRole("button", { name: /Логотип/ });

  await userEvent.click(bar);
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

  await userEvent.click(bar);
  await userEvent.click(screen.getByRole("button", { name: /закрыть/i }));
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

  await userEvent.click(bar);
  await userEvent.click(bar);
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});

it("не показывает блок внутренней заметки, если сервер её не прислал", async () => {
  const withoutNote = { ...STATE, tasks: [{ ...STATE.tasks[0] }] };
  delete (withoutNote.tasks[0] as any).internal_note;
  renderProject(withoutNote);

  await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
  expect(screen.queryByLabelText(/внутренняя заметка/i)).not.toBeInTheDocument();
});

it("показывает вычисленную сервером дату окончания и не считает её сама", async () => {
  renderProject();
  await userEvent.click(await screen.findByRole("button", { name: /Логотип/ }));
  expect(screen.getByText("10 мар")).toBeInTheDocument();
});
```

Третий тест — про то же правило видимости, что и на сервере: интерфейс не решает, показывать ли заметку, он смотрит, прислали ли её.

- [x] **Step 2: Запустить и убедиться, что падают**

- [x] **Step 3: Реализовать панель**

Диаграмма занимает всю ширину, пока панель закрыта. Открытие не должно менять горизонтальную прокрутку ленты — иначе задача, по которой кликнули, уезжает из виду.

- [x] **Step 4: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run src/task
git add frontend/src/task/ frontend/src/gantt/
git commit -m "feat: карточка задачи"
```

---

### Task 3: Правка полей на месте

**Files:**
- Modify: `frontend/src/task/TaskPanel.tsx`
- Create: `frontend/src/task/fields.tsx`
- Test: `frontend/src/task/TaskPanel.edit.test.tsx`

**Interfaces:**
- Produces: редактируемые поля панели — описание, категория, старт, длительность, критичность, прогресс, исполнители, внутренняя заметка.

- [x] **Step 1: Написать падающие тесты**

```tsx
it("сохраняет описание одной операцией, а не тремя", async () => {
  const sent = captureMutations();
  renderProject();
  await openPanel();

  await userEvent.clear(screen.getByLabelText(/описание/i));
  await userEvent.type(screen.getByLabelText(/описание/i), "Знак и логотип");
  await userEvent.tab();

  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].op.type).toBe("set_task_fields");
});

it("не шлёт операцию, если значение не изменилось", async () => {
  const sent = captureMutations();
  renderProject();
  await openPanel();

  await userEvent.click(screen.getByLabelText(/описание/i));
  await userEvent.tab();

  expect(sent).toHaveLength(0);
});

it("смена даты старта уходит операцией переноса", async () => {
  const sent = captureMutations();
  renderProject();
  await openPanel();

  fireEvent.change(screen.getByLabelText(/старт/i), { target: { value: "2026-03-19" } });

  await waitFor(() => expect(sent[0].op).toMatchObject({
    type: "move_task", start_date: "2026-03-19" }));
});

it("возвращает прежнее значение, если сервер отказал", async () => {
  server.use(http.post("/api/projects/p1/mutations", () =>
    HttpResponse.json({ detail: "progress_out_of_range" }, { status: 422 })));

  renderProject();
  await openPanel();
  fireEvent.change(screen.getByLabelText(/выполнено/i), { target: { value: "150" } });

  expect(await screen.findByText(/от 0 до 100/i)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText(/выполнено/i)).toHaveValue(40));
});

it("исполнители переключаются по одному и каждый своей операцией", async () => {
  const sent = captureMutations();
  renderProject();
  await openPanel();

  await userEvent.click(screen.getByRole("button", { name: /Мария/ }));
  await waitFor(() => expect(sent[0].op.type).toBe("assign_user"));

  await userEvent.click(screen.getByRole("button", { name: /Мария/ }));
  await waitFor(() => expect(sent[1].op.type).toBe("unassign_user"));
});
```

Второй тест важен для истории: поле, теряющее фокус без изменений, не должно оставлять запись «изменил описание» — иначе лента истории заполняется шумом и перестаёт читаться.

- [x] **Step 2: Запустить и убедиться, что падают**

- [x] **Step 3: Реализовать поля**

Три текстовых поля уходят одной операцией `set_task_fields`, потому что человек воспринимает их как одно действие. Остальные — своими операциями, потому что и меняются по одному.

Отдельного режима редактирования и кнопки «сохранить» нет: значение уходит при потере фокуса или при выборе в списке.

- [x] **Step 4: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run src/task
git add frontend/src/task/
git commit -m "feat: правка полей задачи на месте"
```

---

### Task 4: Перетаскивание дат

**Files:**
- Create: `frontend/src/gantt/useDragDates.ts`
- Modify: `frontend/src/gantt/Row.tsx`
- Test: `frontend/src/gantt/useDragDates.test.tsx`

**Interfaces:**
- Consumes: `buildScale`, `useProjectMutation`.
- Produces: перетаскивание полоски по горизонтали с шагом ровно в один день.

- [x] **Step 1: Написать падающие тесты**

```tsx
it("двигает полоску с шагом в целый день", async () => {
  const sent = captureMutations();
  renderProject();
  const bar = await screen.findByRole("button", { name: /Логотип/ });

  drag(bar, { fromX: 100, toX: 100 + 26 * 3 });

  await waitFor(() => expect(sent[0].op).toMatchObject({
    type: "move_task", start_date: "2026-03-07" }));
});

it("не отправляет ничего, если полоску вернули на место", async () => {
  const sent = captureMutations();
  renderProject();
  const bar = await screen.findByRole("button", { name: /Логотип/ });

  drag(bar, { fromX: 100, toX: 100 + 12 });   // меньше половины дня

  expect(sent).toHaveLength(0);
});

it("не открывает карточку по окончании перетаскивания", async () => {
  renderProject();
  const bar = await screen.findByRole("button", { name: /Логотип/ });

  drag(bar, { fromX: 100, toX: 100 + 26 * 2 });

  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});

it("возвращает полоску на место, если сервер отказал", async () => {
  server.use(http.post("/api/projects/p1/mutations", () =>
    HttpResponse.json({ detail: "task_not_found" }, { status: 404 })));

  renderProject();
  const bar = await screen.findByRole("button", { name: /Логотип/ });
  const before = bar.style.left;

  drag(bar, { fromX: 100, toX: 100 + 26 * 3 });

  await waitFor(() => expect(bar.style.left).toBe(before));
});

it("клавиатура двигает задачу так же, как мышь", async () => {
  const sent = captureMutations();
  renderProject();
  const bar = await screen.findByRole("button", { name: /Логотип/ });

  bar.focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");

  await waitFor(() => expect(sent[0].op).toMatchObject({
    type: "move_task", start_date: "2026-03-05" }));
});
```

Третий тест закрывает раздражающую мелочь: без него каждое перетаскивание заканчивается открытием карточки, потому что браузер после отпускания кнопки шлёт клик.

Пятый — не роскошь: полоска объявлена кнопкой, и человек, работающий с клавиатуры, должен иметь способ сдвинуть задачу.

- [x] **Step 2: Запустить и убедиться, что падают**

- [x] **Step 3: Реализовать**

Указательные события (`pointerdown`/`pointermove`/`pointerup`) с захватом указателя, а не мышиные: захват гарантирует, что перетаскивание не потеряется, если курсор ушёл за край ленты, и заодно работает на планшете.

Смещение в днях считается через шкалу, а не делением на «ширину дня» вручную. Ноль дней — ничего не отправляем.

- [x] **Step 4: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run src/gantt/useDragDates.test.tsx
git add frontend/src/gantt/
git commit -m "feat: перетаскивание дат"
```

---

### Task 5: Перестановка строк

**Files:**
- Create: `frontend/src/gantt/useReorder.ts`
- Modify: `frontend/src/gantt/Row.tsx`
- Test: `frontend/src/gantt/useReorder.test.tsx`

**Interfaces:**
- Produces: перетаскивание строки за левую колонку с линией вставки; бросок на заголовок категории переносит задачу в неё.

- [x] **Step 1: Написать падающие тесты**

```tsx
it("перетаскивание за левую колонку меняет порядок, а не даты", async () => {
  const sent = captureMutations();
  renderProject(THREE_TASKS);

  dragRow("Третья", { over: "Первая", half: "top" });

  await waitFor(() => expect(sent[0].op).toMatchObject({
    type: "reorder_task", position: 0 }));
  expect(sent[0].op).not.toHaveProperty("start_date");
});

it("бросок на заголовок категории переносит задачу в неё", async () => {
  const sent = captureMutations();
  renderProject(TWO_CATEGORIES);

  dragRow("Логотип", { over: "Разработка", isCategory: true });

  await waitFor(() => expect(sent[0].op).toMatchObject({
    type: "reorder_task", category_id: "c2" }));
});

it("показывает линию вставки сверху или снизу в зависимости от курсора", () => {
  renderProject(THREE_TASKS);

  hoverRowWhileDragging("Третья", { over: "Первая", half: "top" });
  expect(rowOf("Первая")).toHaveClass("drop-before");

  hoverRowWhileDragging("Третья", { over: "Первая", half: "bottom" });
  expect(rowOf("Первая")).toHaveClass("drop-after");
});

it("перетаскивание полоски не меняет порядок", async () => {
  const sent = captureMutations();
  renderProject(THREE_TASKS);

  drag(await screen.findByRole("button", { name: /Третья/ }), { fromX: 100, toX: 152 });

  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].op.type).toBe("move_task");
});

it("в гостевом режиме строки не перетаскиваются", () => {
  renderProject(THREE_TASKS, { canWrite: false });
  expect(rowHandle("Первая")).not.toBeInTheDocument();
});
```

Первый и четвёртый тесты вместе закрепляют разделение жестов — то самое, ради которого оно и вводилось.

- [x] **Step 2: Запустить и убедиться, что падают**

- [x] **Step 3: Реализовать**

Ручка перетаскивания появляется при наведении на строку. Сервер сам раздвигает соседей и пишет сдвиги в журнал — клиент шлёт только целевую позицию и категорию.

- [x] **Step 4: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run src/gantt/useReorder.test.tsx
git add frontend/src/gantt/
git commit -m "feat: перестановка строк перетаскиванием"
```

---

### Task 6: История задачи

**Files:**
- Create: `frontend/src/task/History.tsx`
- Create: `frontend/src/task/formatEvent.ts`
- Create: `frontend/src/api/revisions.ts`
- Test: `frontend/src/task/formatEvent.test.ts`

**Interfaces:**
- Consumes: журнал ревизий, отфильтрованный по задаче.
- Produces: `formatEvent(op, locale) -> string`; блок истории в карточке.

Здесь окупается решение хранить событие с параметрами, а не готовую фразу: одна и та же запись читается на трёх языках.

- [x] **Step 1: Написать падающие тесты**

```ts
it("собирает фразу переноса на языке читателя", () => {
  const op = { type: "move_task", task_id: "t1", from: "2026-03-12", to: "2026-03-19" };
  expect(formatEvent(op, "ru")).toBe("перенёс старт с 12 мар на 19 мар");
  expect(formatEvent(op, "az")).toBe("başlanğıcı 12 mar → 19 mar dəyişdi");
});

it("склоняет длительность по правилам языка", () => {
  const op = { type: "set_duration", task_id: "t1", from: 14, to: 21 };
  expect(formatEvent(op, "ru")).toBe("изменил длительность с 14 дней на 21 день");
});

it("перечисляет только изменившиеся поля", () => {
  const op = {
    type: "set_task_fields", task_id: "t1",
    from: { name: "Лого", description: "", internal_note: "" },
    to: { name: "Лого", description: "Знак", internal_note: "" },
  };
  expect(formatEvent(op, "ru")).toBe("изменил описание");
});

it("не падает на неизвестном типе события", () => {
  expect(formatEvent({ type: "invented_later", task_id: "t1" }, "ru")).toBe("изменил задачу");
});
```

Последний тест — про совместимость: журнал переживёт версии приложения, и запись, сделанная новой версией, не должна ронять карточку в старой вкладке.

- [x] **Step 2: Запустить и убедиться, что падают**

- [x] **Step 3: Реализовать**

Причина сдвига выводится как есть, без перевода: это текст пользователя.

- [x] **Step 4: Реализовать блок истории**

Новые записи сверху. Дата и автор — рядом с событием.

- [x] **Step 5: Прогнать тесты и закоммитить**

```bash
cd frontend && npx vitest run src/task
git add frontend/src/task/ frontend/src/api/revisions.ts
git commit -m "feat: история задачи на языке читателя"
```

---

### Task 7: Движение и стрелки связей

**Files:**
- Modify: `frontend/src/gantt/gantt.css`
- Create: `frontend/src/gantt/Arrows.tsx`
- Test: `frontend/src/gantt/Arrows.test.tsx`, `frontend/src/gantt/motion.test.tsx`

**Interfaces:**
- Produces: слой стрелок связей; переходы при появлении, исчезновении и сдвиге полосок.

- [x] **Step 1: Написать падающие тесты**

```tsx
it("рисует стрелку между связанными задачами", () => {
  const { container } = renderProject(WITH_DEPENDENCY);
  expect(container.querySelectorAll("svg.arrows polyline")).toHaveLength(1);
});

it("перерисовывает стрелки при открытии карточки", async () => {
  const { container } = renderProject(WITH_DEPENDENCY);
  const before = container.querySelector("polyline")!.getAttribute("points");

  await userEvent.click(screen.getByRole("button", { name: /Логотип/ }));

  await waitFor(() => {
    expect(container.querySelector("polyline")!.getAttribute("points")).not.toBe(before);
  });
});

it("отключает переходы, если человек просил меньше движения", () => {
  matchMediaMock("(prefers-reduced-motion: reduce)", true);
  const { container } = renderProject();
  expect(container.querySelector(".gantt")).toHaveClass("motion-off");
});
```

Второй тест ловит ошибку, которая уже случалась в прототипе: стрелки считаются от положения полосок, и при изменении ширины области они уезжают, если их не пересчитать.

- [x] **Step 2: Запустить и убедиться, что падают**

- [x] **Step 3: Реализовать стрелки**

Слой SVG поверх ленты, координаты считаются от реальных положений полосок после отрисовки.

- [x] **Step 4: Реализовать переходы**

Что анимируется: появление и исчезновение полоски, сдвиг полоски после подтверждения сервером, выезд панели задачи, линия вставки при перетаскивании.

Что **не** анимируется: полоска под курсором во время перетаскивания — она обязана следовать за пальцем без задержки, иначе жест ощущается вязким.

При `prefers-reduced-motion: reduce` переходы выключаются целиком.

- [x] **Step 5: Прогнать весь набор и собрать**

```bash
cd frontend && npx vitest run && npm run build
```

- [x] **Step 6: Проверить вживую**

Против настоящего бэкенда, полный сценарий: создать проект с двумя категориями и четырьмя задачами, связать две стрелкой, подвигать полоски мышью и клавиатурой, переставить строки, перенести задачу в другую категорию, отредактировать поля в карточке, прочитать историю на трёх языках по очереди. Отдельно проверить, что после перезагрузки страницы всё сохранилось — то есть операции действительно доехали до сервера, а не остались оптимистичной иллюзией.

- [x] **Step 7: Закоммитить**

```bash
git add frontend/
git commit -m "feat: стрелки связей и движение интерфейса"
```

---

## Что этот план не делает

- Утверждение плана, базовый план, порог с обязательной причиной и призрак под полоской — следующий план. Поля `baseline_start` и `baseline_duration` приходят в состоянии и пока не отображаются.
- Живые обновления по WebSocket, публичные ссылки и комментарии — план после него.
- Отмену действия. Механизм на сервере есть, маршрута нет; кнопка появится вместе с откатом пачки от AI.
- Масштаб диаграммы (неделя, месяц). Шкала параметризована шириной дня, так что переключатель добавится дёшево, но в этот план не входит.
- Редактирование настроек проекта: дедлайн, календарь, порог сдвига.
