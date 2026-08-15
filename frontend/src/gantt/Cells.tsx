import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import type { Task } from "../api/projects";
import type { ColumnKey, ColumnLayout } from "./columns";
import { MIN_WIDTH, clampWidth } from "./columns";

/**
 * Ячейки закреплённой таблицы — левой части ленты.
 *
 * Одна раскладка на три места: шапку, строку категории и строку задачи. Ширины
 * приходят из неё же, поэтому колонка, потянутая за границу в шапке,
 * сдвигается сразу во всех строках — второго списка ширин, который однажды
 * разойдётся с первым, не существует.
 *
 * Правятся прямо здесь только те поля, которые операции уже умеют менять
 * поодиночке: старт, длительность, процент. Дата окончания — показ и только:
 * её считает сервер по календарю проекта, и поле для правки обещало бы
 * влияние, которого нет (та же причина, что и в карточке задачи).
 */

export type CellText = { text: string; title?: string };

/** Ячейка, которую правят на месте: показ до щелчка, поле после. */
export function EditableCell({
  value,
  display,
  type,
  disabled,
  label,
  min,
  max,
  onCommit,
}: {
  /** Значение в том виде, в каком его примет поле ввода. */
  value: string;
  /** Значение в том виде, в каком его читают глазами. */
  display: string;
  type: "date" | "number";
  disabled?: boolean;
  label: string;
  min?: number;
  max?: number;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);

  // Пока ячейку не открывали, черновик обязан идти за правдой: сосед по
  // проекту двигает полоску, и ячейка рядом не должна показывать вчерашнее
  // число. Открытую ячейку правда не трогает — иначе чужая правка стирала бы
  // то, что человек в этот момент набирает.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  if (!editing || disabled) {
    // Не кнопка — по той же причине, по которой не кнопка имя задачи слева
    // (см. Row): шесть колонок на сотне строк дали бы шестьсот шагов Tab, и
    // ни один из них не вёл бы туда, куда нельзя дойти иначе, — те же поля
    // лежат в карточке задачи, до которой с клавиатуры один шаг. Щелчок
    // остаётся доступен указателем и не обещает того, чего не выполняет.
    return (
      <span
        className={`gantt__cell-value${disabled ? "" : " gantt__cell-value--editable"}`}
        title={display}
        onClick={disabled ? undefined : () => setEditing(true)}
      >
        {display === "" ? "—" : display}
      </span>
    );
  }

  const commit = () => {
    setEditing(false);
    // Пустое поле — середина набора, а не значение: отправлять его значит
    // просить сервер отказать в том, чего человек не просил.
    if (draft !== "" && draft !== value) onCommit(draft);
  };

  return (
    <input
      ref={input}
      className="gantt__cell-input"
      type={type}
      value={draft}
      min={min}
      max={max}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          // Передумать посреди набора — обычное дело, и выходом иначе было бы
          // вспомнить прежнее значение и набрать его обратно.
          event.preventDefault();
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

/** Одна ячейка строки: ширину задаёт раскладка, содержимое — вызывающий. */
export function Cell({
  column,
  layout,
  children,
}: {
  column: ColumnKey;
  layout: ColumnLayout;
  children: ReactNode;
}) {
  return (
    <span
      className={`gantt__cell gantt__cell--${column}`}
      style={{ flex: `0 0 ${layout.widths[column]}px`, width: layout.widths[column] }}
    >
      {children}
    </span>
  );
}

/**
 * Шапка таблицы: подписи колонок и границы, за которые их тянут.
 *
 * Граница — отдельный узел поверх стыка, а не `resize` у ячейки: CSS-ресайз
 * тянется только за правый нижний угол и оставляет в нём засечку, которой в
 * шапке таблицы взяться неоткуда.
 */
export function HeadCells({
  layout,
  labels,
  onResize,
  resizeLabel,
}: {
  layout: ColumnLayout;
  labels: Record<ColumnKey, string>;
  /** `undefined` — ширины не меняются (у ленты нет памяти, например в тесте). */
  onResize?: (column: ColumnKey, width: number) => void;
  resizeLabel: (column: string) => string;
}) {
  return (
    <>
      {layout.shown.map((column) => (
        <Cell key={column} column={column} layout={layout}>
          <span className="gantt__corner-label">{labels[column]}</span>
          {onResize && (
            <ColumnGrip
              width={layout.widths[column]}
              label={resizeLabel(labels[column])}
              onResize={(width) => onResize(column, width)}
            />
          )}
        </Cell>
      ))}
    </>
  );
}

/**
 * Граница колонки: тянется указателем, ходит стрелками с клавиатуры.
 *
 * Стрелки здесь не формальность ради доступности: попасть указателем в полосу
 * в четыре пикселя трудно и мышью, а ширина — единственное свойство таблицы,
 * которое иначе не настроить вовсе.
 */
function ColumnGrip({
  width,
  label,
  onResize,
}: {
  width: number;
  label: string;
  onResize: (width: number) => void;
}) {
  const from = useRef<{ pointerId: number; x: number; width: number } | null>(null);

  return (
    <span
      className="gantt__col-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        from.current = { pointerId: event.pointerId, x: event.clientX, width };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = from.current;
        if (start === null || start.pointerId !== event.pointerId) return;
        onResize(clampWidth(start.width + (event.clientX - start.x)));
      }}
      onPointerUp={() => {
        from.current = null;
      }}
      onPointerCancel={() => {
        from.current = null;
      }}
      onKeyDown={(event) => {
        const step = event.key === "ArrowRight" ? 8 : event.key === "ArrowLeft" ? -8 : 0;
        if (step === 0) return;
        event.preventDefault();
        onResize(clampWidth(width + step));
      }}
    />
  );
}

/** Сводка по группе строк — то, что показывает строка категории. */
export function rollUp(tasks: Task[]): { start: string; end: string; progress: number } | null {
  if (tasks.length === 0) return null;
  // Процент группы — средний по длительностям, а не по числу строк: неделя,
  // сделанная наполовину, весит больше, чем сделанный целиком однодневный
  // созвон, и «50 %» по головам говорило бы обратное.
  const work = tasks.reduce((total, task) => total + task.duration_days, 0);
  const done = tasks.reduce((total, task) => total + task.duration_days * task.progress_pct, 0);
  return {
    start: tasks.reduce((a, t) => (t.start_date < a ? t.start_date : a), tasks[0].start_date),
    end: tasks.reduce((a, t) => (t.end_date > a ? t.end_date : a), tasks[0].end_date),
    progress: work === 0 ? 0 : Math.round(done / work),
  };
}
