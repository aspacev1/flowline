import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

/**
 * Заведение строки сметы — строкой в таблице, тем же движением, что задача в
 * ленте (gantt/NewTaskRow): смету пишут списком, по строке на работу, и окно
 * между строками означало бы открыть, заполнить, закрыть — двадцать раз
 * подряд. Спрашивается одно имя; роль, оценка и ставка правятся в карточке.
 *
 * Правила клавиш — дословно оттуда же. Enter отправляет написанное и
 * оставляет поле пустым и в фокусе: следующую строку пишут сразу, не касаясь
 * мыши. Пустой Enter значит «больше не нужно» и строку закрывает. Esc
 * отменяет набранное. Уход фокуса сохраняет: имя, пропавшее от щелчка мимо
 * поля, человек считал бы потерянной работой, а не отменённым вводом.
 */
export function NewProposalTaskRow({
  columns,
  label,
  placeholder,
  onCreate,
  onClose,
}: {
  /** Сколько колонок накрыть: поле имени тянется на всю ширину таблицы. */
  columns: number;
  /** Имя поля при чтении с экрана: «Новая строка в „Discovery“». */
  label: string;
  placeholder: string;
  /** Отправить написанное. Строка при этом остаётся открытой. */
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // Фокус — сразу: «плюс» нажимают ради того, чтобы писать.
  useEffect(() => {
    input.current?.focus();
  }, []);

  /** Отправлено или нет: пустое поле — не работа, а середина набора. */
  const submit = (): boolean => {
    const trimmed = name.trim();
    if (trimmed === "") return false;
    onCreate(trimmed);
    setName("");
    return true;
  };

  return (
    <tr className="proposal-row proposal-row--new">
      <td colSpan={columns}>
        <input
          ref={input}
          className="proposal-table__input"
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
              event.preventDefault();
              onClose();
            }
          }}
          onBlur={() => {
            submit();
            onClose();
          }}
        />
      </td>
    </tr>
  );
}
