import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, PointerEvent, ReactNode } from "react";

import type { Task } from "../api/projects";
import { modKeyLabel } from "../components/hotkeys";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Карточка, которая показывает под курсором то, чего на полоске не написано.
 *
 * Полоска умещает название и проценты, а остальное — статус, даты, исполнителей
 * — человек узнаёт, только открыв карточку задачи. Наведение отвечает на те же
 * вопросы, не уводя с ленты и ничего не открывая.
 *
 * Узел один на всю ленту, а не по одному на полоску: на сотне задач это сотня
 * скрытых узлов ни за чем. Отсюда и контекст — иначе через строку пришлось бы
 * протаскивать пять новых пропсов, ни один из которых строке не нужен.
 */

/** Точка, от которой карточка отсчитывает своё место: курсор или край полоски. */
type Anchor = { x: number; y: number };

type BarTipApi = {
  /** `keys` — показывать ли строку сочетаний: она про то, чего гость не может. */
  show: (task: Task, anchor: Anchor, keys: boolean) => void;
  /** Двигать за курсором — но только ту карточку, которая уже видна. */
  track: (anchor: Anchor) => void;
  hide: () => void;
  /** Нажатие: карточка гаснет и запирается до конца жеста. */
  press: () => void;
  /** Отпускание: замок снимается, но карточка сама не возвращается. */
  release: () => void;
};

const BarTipContext = createContext<BarTipApi | null>(null);

/** Отступ карточки от курсора — как в макете. */
const GAP = 14;
/** Ширина карточки. Та же величина стоит в стилях: шире имени она не станет. */
const TIP_WIDTH = 235;
/**
 * Высота, по которой карточка решает, переворачиваться ли у нижнего края.
 *
 * Число, а не измерение живого узла: измерять пришлось бы после отрисовки, то
 * есть показать карточку не на месте и переставить её следующим кадром. Запас
 * взят с избытком — ошибка в большую сторону лишь раньше переворачивает
 * карточку, ошибка в меньшую оставила бы её за обрезом экрана.
 *
 * Строка сочетаний прибавляет к высоте свои две строки текста: без поправки
 * карточка у нижнего края экрана переворачивалась бы позже, чем нужно, и
 * подсказка оказывалась бы за обрезом — то есть пропадала бы ровно то, ради
 * чего её и добавили.
 */
const TIP_HEIGHT = 96;
const TIP_KEYS_HEIGHT = 44;

/** Карточка не выходит за край экрана: у края она переворачивается на другую сторону. */
function placeTip({ x, y }: Anchor, keys: boolean): CSSProperties {
  const height = TIP_HEIGHT + (keys ? TIP_KEYS_HEIGHT : 0);
  const left = x + GAP + TIP_WIDTH > window.innerWidth ? x - GAP - TIP_WIDTH : x + GAP;
  const top = y + GAP + height > window.innerHeight ? y - GAP - height : y + GAP;
  return { left: Math.max(GAP, left), top: Math.max(GAP, top) };
}

export function BarTipProvider({
  names,
  children,
}: {
  /**
   * Имена исполнителей по идентификаторам. Приходят пропсом сверху и никогда
   * не спрашиваются отсюда: лента не должна решать, у кого что спрашивать, —
   * на публичной странице состав организации не отдаётся вовсе.
   */
  names?: ReadonlyMap<string, string>;
  children: ReactNode;
}) {
  const [tip, setTip] = useState<{ task: Task; anchor: Anchor; keys: boolean } | null>(null);
  // Идёт ли жест. В ref, а не в состоянии: значение читается в обработчиках
  // указателя и на отрисовку не влияет.
  const pressed = useRef(false);

  const api = useMemo<BarTipApi>(
    () => ({
      show: (task, anchor, keys) => {
        if (pressed.current) return;
        setTip({ task, anchor, keys });
      },
      // Наведение показывает, движение только переставляет: иначе карточка
      // возвращалась бы прямо под пальцем сразу после перетаскивания — а
      // человек к этому моменту уже целится в соседний день.
      track: (anchor) => setTip((current) => (current === null ? null : { ...current, anchor })),
      hide: () => setTip(null),
      press: () => {
        pressed.current = true;
        setTip(null);
      },
      release: () => {
        pressed.current = false;
      },
    }),
    [],
  );

  return (
    <BarTipContext.Provider value={api}>
      {children}
      {tip && <BarTip task={tip.task} anchor={tip.anchor} keys={tip.keys} names={names} />}
    </BarTipContext.Provider>
  );
}

/**
 * Обработчики полоски.
 *
 * Возвращаются готовым набором, а не по одному: полоска и без того несёт на
 * себе перетаскивание, и разбирать, какое событие чьё, в разметке не надо.
 * Вне провайдера все они молчат — диаграмма рисуется и там, где карточки нет.
 *
 * `keys` — право двигать полоску: строка сочетаний показывается только тому,
 * кому есть что ими сделать. Читателю и гостю она обещала бы работу, которую
 * сервер отклонит.
 */
export function useBarTip(task: Task, keys = false) {
  const api = useContext(BarTipContext);
  const cursor = useCallback(
    (event: PointerEvent<HTMLElement>): Anchor => ({ x: event.clientX, y: event.clientY }),
    [],
  );

  return useMemo(
    () => ({
      onPointerEnter: (event: PointerEvent<HTMLElement>) => api?.show(task, cursor(event), keys),
      onPointerMove: (event: PointerEvent<HTMLElement>) => api?.track(cursor(event)),
      onPointerLeave: () => api?.hide(),
      onPointerDown: () => api?.press(),
      onPointerUp: () => api?.release(),
      onPointerCancel: () => api?.release(),
      // С клавиатуры курсора нет, и карточка встаёт у самой полоски: место под
      // курсором означало бы точку, которой на экране никто не видит.
      onFocus: (event: FocusEvent<HTMLElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        api?.show(task, { x: box.left, y: box.bottom }, keys);
      },
      onBlur: () => api?.hide(),
    }),
    [api, cursor, keys, task],
  );
}

/**
 * Сама карточка.
 *
 * Скрыта от чтения с экрана: всё, что в ней написано, полоска уже называет
 * своим `aria-label`, и второй голос об одном и том же только удлиняет
 * прочтение ленты.
 */
function BarTip({
  task,
  anchor,
  keys,
  names,
}: {
  task: Task;
  anchor: Anchor;
  keys: boolean;
  names?: ReadonlyMap<string, string>;
}) {
  const { t } = useLocale();

  // Короткая форма даты, а не полная: карточка шириной 235px, и «12 августа —
  // 14 августа» в её правой колонке переносится на вторую строку.
  const dates = `${formatShortDate(t, task.start_date)} → ${formatShortDate(t, task.end_date)}`;
  const status =
    task.status === "blocked"
      ? `⚠ ${t(`task.status.${task.status}`)}`
      : t(`task.status.${task.status}`);
  const people = assigneeText(task, t, names);

  return (
    <div
      className="gantt__tip"
      style={placeTip(anchor, keys)}
      data-testid="bar-tip"
      aria-hidden="true"
    >
      {/* Название — содержимое пользователя: не переводится. */}
      <strong className="gantt__tip-name">{task.name}</strong>
      <div className="gantt__tip-grid">
        <span>{status}</span>
        <b>{dates}</b>
        {people !== null && <span>{people}</span>}
        {/* Без исполнителей процент остаётся в своей колонке: сдвинутый влево,
            он читался бы приглушённой подписью к пустоте. */}
        <b className={people === null ? "gantt__tip-alone" : undefined}>{task.progress_pct}%</b>
      </div>
      {/* Сочетания клавиш — здесь, а не в отдельной справке: карточка и так
          висит над той самой полоской, к которой они относятся, и это
          единственное место, где человек читает про задачу, ничего не открыв.
          Скрыта от чтения с экрана вместе со всей карточкой — тому, кто читает
          с экрана, о том же говорит `aria-keyshortcuts` полоски. */}
      {keys && (
        <div className="gantt__tip-keys">{t("gantt.tip.keys", { mod: modKeyLabel() })}</div>
      )}
    </div>
  );
}

/**
 * Строка исполнителей: одного зовут по имени, нескольких — «первый и ещё N».
 *
 * Перечисления карточка такой ширины не выдержит, а «и ещё 2» отвечает на
 * вопрос «одна ли это работа» не хуже трёх имён. Имён нет вовсе — строки нет:
 * пустое место честнее прочерка, который читался бы как «никто не назначен»
 * там, где состав просто не спрашивали.
 */
function assigneeText(
  task: Task,
  t: (key: string, params?: Record<string, string | number>) => string,
  names?: ReadonlyMap<string, string>,
): string | null {
  if (names === undefined) return null;
  const known = task.assignee_ids
    .map((id) => names.get(id))
    .filter((name): name is string => name !== undefined);
  if (known.length === 0) return null;
  if (known.length === 1) return known[0];
  return t("gantt.tip.more", { name: known[0], count: known.length - 1 });
}
