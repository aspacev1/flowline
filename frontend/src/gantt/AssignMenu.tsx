import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { Task } from "../api/projects";
import { Avatar } from "../components/Avatar";
import { useEscape } from "../components/useEscape";
import { useLocale } from "../i18n/LocaleProvider";
import { patchTask } from "../project/optimistic";
import { useProjectMutation } from "../project/useProjectMutation";

/**
 * Исполнители задачи прямо со строки ленты.
 *
 * Назначить человека можно было только в карточке задачи — то есть открыв её,
 * найдя блок исполнителей и закрыв обратно. А раздают работу пачками, глядя на
 * весь план сразу: «этих троих — Нигяр, эту неделю — Алексею». Отсюда кнопка на
 * строке: назначение — единственное действие, которое делают не по одной
 * задаче, а по списку.
 *
 * Панель стоит по координатам окна и рисуется в конце документа, а не внутри
 * строки. Обе части важны, и вторая — не следствие первой: закреплённая
 * колонка ленты позиционирована и держит свой слой (`sticky` с z-index), а
 * слой замыкает всё, что внутри, — включая `position: fixed`. Панель,
 * оставленная в строке, уходила бы под соседние строки, сколько бы ей ни
 * назначили z-index. Тот же довод, что у карточки наведения (см. BarTip), — с
 * той разницей, что там узел один на всю ленту и живёт рядом с ней, а здесь
 * панель принадлежит своей строке и выносится порталом.
 */

/** Сколько аватаров помещается на кнопке, прежде чем остальные сворачиваются в «+N». */
const SHOWN_AVATARS = 3;

/** Мера панели. Нужна до отрисовки: по ней решается, откроется она вниз или вверх. */
const PANEL_WIDTH = 224;
const PANEL_HEIGHT = 268;
/** Просвет между кнопкой и панелью — и минимальный отступ от края окна. */
const GAP = 6;

type Point = { left: number; top: number };

/** Место панели: под кнопкой, а у нижнего края экрана — над ней. */
function placeBelow(rect: DOMRect): Point {
  const left = Math.max(
    GAP,
    Math.min(rect.left, (window.innerWidth || PANEL_WIDTH) - PANEL_WIDTH - GAP),
  );
  const below = rect.bottom + GAP;
  const fits = below + PANEL_HEIGHT <= (window.innerHeight || 0);
  return { left, top: fits ? below : Math.max(GAP, rect.top - GAP - PANEL_HEIGHT) };
}

export function AssignMenu({
  projectId,
  task,
  roster,
  describedBy,
}: {
  projectId: string;
  task: Task;
  /** Состав организации: имена по идентификаторам. */
  roster: ReadonlyMap<string, string>;
  /**
   * Узел с названием задачи в той же строке.
   *
   * Название кнопки — «Исполнители», без имени задачи, а сама задача названа
   * описанием. Разница не косметическая: с именем внутри подписи кнопка на
   * ленте становится вторым органом управления, чьё доступное имя содержит
   * название задачи, — и «найди кнопку задачи X» перестаёт означать одно
   * определённое место. Описание же читается вслед за именем и говорит ровно
   * то, что нужно: «Исполнители, кнопка, Логотип».
   */
  describedBy?: string;
}) {
  const { t } = useLocale();
  const { apply } = useProjectMutation(projectId);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Точка, а не «открыто/закрыто»: место панели считается один раз, в момент
  // открытия, — панель за строкой не едет и при первом же движении гаснет.
  const [at, setAt] = useState<Point | null>(null);
  const open = at !== null;

  useEscape(() => setAt(null), open);

  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    function onPointerDown(event: globalThis.PointerEvent) {
      const target = event.target as Node;
      const inside =
        root.current?.contains(target) === true || panel.current?.contains(target) === true;
      if (!inside) close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    // Захват, а не всплытие: прокручивается лента, а не окно, и её событие до
    // окна иначе не доходит вовсе. Панель при этом закрывается, а не едет
    // следом: она открыта на секунду, и догонять ею уезжающую кнопку незачем.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = (userId: string) => {
    const assigned = task.assignee_ids.includes(userId);
    void apply(
      {
        type: assigned ? "unassign_user" : "assign_user",
        task_id: task.id,
        user_id: userId,
      },
      (state) =>
        patchTask(state, task.id, {
          assignee_ids: assigned
            ? task.assignee_ids.filter((id) => id !== userId)
            : [...task.assignee_ids, userId],
        }),
      // Отказ молчит: догадка уже откачена внутри `apply`, и аватар вернулся
      // на строку сам. Второе объяснение здесь читалось бы как поломка там,
      // где человек и так видит, что назначение не удержалось.
    ).catch(() => {});
  };

  // Имена в том порядке, в каком их прислал сервер: состав организации
  // читается одним и тем же списком и в карточке, и здесь.
  const members = [...roster].map(([id, name]) => ({ id, name }));
  const assigned = task.assignee_ids
    .map((id) => ({ id, name: roster.get(id) }))
    .filter((member): member is { id: string; name: string } => member.name !== undefined);
  const label =
    assigned.length === 0
      ? t("gantt.assign.empty")
      : t("gantt.assign.some", { names: assigned.map((member) => member.name).join(", ") });

  return (
    <span className="gantt__assign" ref={root}>
      <button
        ref={button}
        type="button"
        className={`gantt__assign-button${assigned.length === 0 ? " is-empty" : ""}`}
        aria-expanded={open}
        aria-label={t("gantt.assign.label")}
        aria-describedby={describedBy}
        title={label}
        onClick={() => {
          if (open) {
            setAt(null);
            return;
          }
          const rect = button.current?.getBoundingClientRect();
          if (rect) setAt(placeBelow(rect));
        }}
      >
        {assigned.length === 0 ? (
          <>
            <PeopleIcon />
            <span className="gantt__assign-empty">{t("gantt.assign.empty")}</span>
          </>
        ) : (
          <>
            {assigned.slice(0, SHOWN_AVATARS).map((member) => (
              <Avatar key={member.id} name={member.name} size={20} />
            ))}
            {assigned.length > SHOWN_AVATARS && (
              <span className="gantt__assign-more">+{assigned.length - SHOWN_AVATARS}</span>
            )}
          </>
        )}
      </button>

      {at &&
        createPortal(
          <div
            className="gantt__assign-pop"
            style={{ left: at.left, top: at.top, width: PANEL_WIDTH }}
            role="group"
            aria-label={t("gantt.assign.aria", { name: task.name })}
            data-testid={`assign-${task.id}`}
            // Панель вынесена из строки, и щелчок по ней больше не считается
            // щелчком внутри `root` (см. слушатель выше): без этой отметки
            // выбор исполнителя закрывал бы панель сам.
            ref={panel}
          >
            {members.map((member) => (
              // Каждый исполнитель — своя операция, как и в карточке: их
              // снимают по одному, и в истории они читаются как отдельные
              // события. Панель после выбора не закрывается — на задачу сажают
              // двоих и троих подряд.
              <button
                key={member.id}
                type="button"
                className="gantt__assign-item"
                aria-pressed={task.assignee_ids.includes(member.id)}
                onClick={() => toggle(member.id)}
              >
                <Avatar name={member.name} size={22} />
                {/* Имя человека — содержимое, а не хрома. */}
                <span className="gantt__assign-name">{member.name}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}

/**
 * Знак «люди» — рисунком, а не буквой и не эмодзи.
 *
 * Эмодзи здесь рисуется цветной картинкой шрифта системы и в ряду тонких
 * линий ленты выглядит наклейкой; к тому же на разных системах это разные
 * картинки. Рисунок берёт цвет текста и меняется вместе с ним.
 */
function PeopleIcon() {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="6" cy="5" r="2.4" />
      <path d="M1.6 13.2c0-2.3 2-3.8 4.4-3.8s4.4 1.5 4.4 3.8" />
      <circle cx="11.6" cy="5.6" r="1.9" />
      <path d="M11.6 9.6c2 0 3.4 1.3 3.4 3.3" />
    </svg>
  );
}
