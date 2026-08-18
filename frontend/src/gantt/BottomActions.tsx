import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import type { Scale } from "./timescale";

/**
 * Низ ленты — не край таблицы, а место, где список продолжают.
 *
 * Обе строки ниже стоят один раз, после самой последней категории, — а не по
 * разу на категорию, как «плюс» на её собственной строке (см. CategoryRow).
 * Приглашение продолжить проект показывают там, где он на самом деле
 * заканчивается сейчас, и оно едет вниз вместе с новым содержимым само —
 * потому что стоит после него в том же потоке разметки, а не поверх него
 * отдельным слоем.
 *
 * Обе — строки ленты по форме: та же сетка `.gantt__label` / `.gantt__lane`,
 * что и у обычной строки. Без пустой полосы шкалы справа лента под ними
 * обрывалась бы по краю таблицы, и правая часть экрана читалась бы короче
 * левой (см. `Lane` ниже и требование к сетке Ганта в макете).
 */

/** Пустая полоса шкалы — своей ширины, без содержимого: полоски здесь ещё
    нет и не будет, но лента не должна обрываться по краю таблицы. */
function Lane({ scale }: { scale: Scale }) {
  return <div className="gantt__lane" style={{ width: scale.width }} />;
}

/**
 * «+ Добавить задачу» — на отступе задачи, в самом конце последней категории.
 *
 * Не кнопка тулбара и не второй «плюс» на строке категории — оба уже есть и
 * никуда не делись. Это третий, самый близкий к тому месту, куда он кладёт
 * задачу: на строку ниже последней задачи последней категории, а не наверх
 * экрана, откуда до неё нужно долистать обратно.
 */
export function AddTaskRow({
  scale,
  label,
  ariaLabel,
  onClick,
}: {
  scale: Scale;
  label: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="gantt__row gantt__row--add gantt__row--add-task">
      <div className="gantt__label">
        <button type="button" className="gantt__add" title={ariaLabel} aria-label={ariaLabel} onClick={onClick}>
          <span className="gantt__add-plus" aria-hidden="true">
            +
          </span>
          <span className="gantt__add-label">{label}</span>
        </button>
      </div>
      <Lane scale={scale} />
    </div>
  );
}

/**
 * «+ Новая категория» — на отступе заголовка категории, самой последней
 * строкой ленты. Соседствует с «+ Добавить задачу», но с ним не спутать:
 * плотнее по весу шрифта и на ступеньку выше — тем же приёмом, каким
 * заголовок категории отличается от задачи под ним, а не размером кнопки.
 */
export function AddCategoryRow({
  scale,
  label,
  onClick,
}: {
  scale: Scale;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="gantt__row gantt__row--add gantt__row--add-category">
      <div className="gantt__label">
        <button type="button" className="gantt__add" onClick={onClick}>
          <span className="gantt__add-plus" aria-hidden="true">
            +
          </span>
          <span className="gantt__add-label">{label}</span>
        </button>
      </div>
      <Lane scale={scale} />
    </div>
  );
}

/**
 * Поле названия новой категории — тем же приёмом, что и `NewTaskRow`: Enter
 * отправляет написанное и оставляет поле пустым и в фокусе, чтобы категории
 * заводили подряд, не касаясь мыши; пустой Enter или Esc закрывают строку;
 * уход фокуса сохраняет набранное, а не отменяет его.
 *
 * Строка встаёт над «+ Новая категория», а не на её месте: сама кнопка при
 * этом никуда не девается — ею заводят следующую, когда эта сохранится.
 */
export function NewCategoryRow({
  scale,
  label,
  placeholder,
  onCreate,
  onClose,
}: {
  scale: Scale;
  label: string;
  placeholder: string;
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = (): boolean => {
    const trimmed = name.trim();
    if (trimmed === "") return false;
    onCreate(trimmed);
    setName("");
    return true;
  };

  return (
    <div className="gantt__row gantt__row--new">
      <div className="gantt__label">
        <div className="gantt__add-field">
          <input
            ref={input}
            className="cell-input"
            type="text"
            value={name}
            placeholder={placeholder}
            aria-label={label}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!submit()) onClose();
              }
              if (event.key === "Escape") {
                // Передумать посреди набора — обычное дело. Строка закрывается
                // размонтированием поля, и `onBlur` до него не доходит:
                // набранное пропадает, как и обещано.
                event.preventDefault();
                onClose();
              }
            }}
            onBlur={() => {
              submit();
              onClose();
            }}
          />
        </div>
      </div>
      <Lane scale={scale} />
    </div>
  );
}

/**
 * Строка категории, которую уже отправили, а сервер ещё не ответил — тем же
 * приёмом, что и `PendingRow` у задачи: оптимистичной строки быть не может
 * (идентификатор и позицию назначает сервер), поэтому вместо догадки — имя,
 * уже видное, и полоса охвата, которой пока нет.
 */
export function PendingCategoryRow({
  scale,
  name,
  title,
}: {
  scale: Scale;
  name: string;
  /** «Создаётся…» — подсказка указателю; строка помечена и `aria-busy`. */
  title: string;
}) {
  return (
    <div className="gantt__row gantt__row--pending" aria-busy>
      <div className="gantt__label">
        <div className="gantt__add-field">
          <span className="gantt__label-name" title={title}>
            {name}
          </span>
        </div>
      </div>
      <Lane scale={scale} />
    </div>
  );
}
