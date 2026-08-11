import { useEffect, useState } from "react";
import type { ReactNode } from "react";

/**
 * Поля карточки.
 *
 * Общее у всех одно: отдельного режима правки и кнопки «сохранить» нет.
 * Значение уходит на сервер само — вопрос только в том, когда именно, и ответ
 * на него зависит от того, чем человек занят.
 *
 * Текст набирают по букве, и отправлять его по букве значило бы писать в
 * историю задачи двадцать записей вместо одной, — поэтому текст уходит при
 * потере фокуса. Дату, список и число выбирают целиком, одним движением, и
 * ждать от них ещё и потери фокуса значит держать сделанный выбор
 * несохранённым неизвестно сколько.
 *
 * Оба вида поля показывают то, что пришло сверху: откат после отказа сервера
 * возвращает значение в состояние, а поле обязано это увидеть. Одной слежки за
 * значением для этого мало. Оптимистичное изменение и откат укладываются в один
 * кадр — сеть отвечает быстрее, чем React успевает отрисовать промежуточное
 * состояние, — и поле, следящее только за `value`, не видит никакого изменения
 * вовсе: было 40, стало 40, а в поле так и осталось отвергнутое 150. Поэтому
 * отказ приносит с собой `resetToken`: он меняется на каждом отказе и заставляет
 * поле вернуться к правде независимо от того, отрисовалась ли догадка.
 */

export function FieldRow({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <p className="panel__field">
      <label htmlFor={id}>{label}</label>
      {children}
    </p>
  );
}

/** Текст: уходит при потере фокуса и только если изменился. */
export function TextField({
  id,
  label,
  value,
  rows,
  disabled,
  resetToken,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  /** Задано — многострочное поле. */
  rows?: number;
  disabled?: boolean;
  /** Меняется, когда сервер отказал: поле обязано вернуться к правде. */
  resetToken?: unknown;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, resetToken]);

  // Сравнение с тем, что пришло сверху, а не с тем, что было при фокусе:
  // поле, из которого вышли, ничего не изменив, не должно оставлять в истории
  // запись «изменил описание». Иначе лента заполняется шумом и перестаёт
  // читаться — а читают её ради того, чтобы понять, кто и что поменял.
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  const shared = {
    id,
    name: id,
    value: draft,
    disabled,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: commit,
  };

  return (
    <FieldRow id={id} label={label}>
      {rows === undefined ? <input {...shared} /> : <textarea {...shared} rows={rows} />}
    </FieldRow>
  );
}

/** Дата или число: уходит сразу, как только значение изменилось. */
export function ValueField({
  id,
  label,
  type,
  value,
  disabled,
  resetToken,
  onCommit,
}: {
  id: string;
  label: string;
  type: "date" | "number";
  value: string;
  disabled?: boolean;
  /** Меняется, когда сервер отказал: поле обязано вернуться к правде. */
  resetToken?: unknown;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, resetToken]);

  return (
    <FieldRow id={id} label={label}>
      <input
        id={id}
        name={id}
        type={type}
        value={draft}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          // Пустое поле — это середина набора, а не значение. Отправлять его
          // значит просить сервер отказать в том, чего человек не просил.
          if (next !== "" && next !== value) onCommit(next);
        }}
      />
    </FieldRow>
  );
}

/** Список: уходит при выборе. */
export function SelectField({
  id,
  label,
  value,
  disabled,
  options,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  options: { value: string; label: string }[];
  onCommit: (value: string) => void;
}) {
  return (
    <FieldRow id={id} label={label}>
      <select
        id={id}
        name={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value !== value) onCommit(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}
