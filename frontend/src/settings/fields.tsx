import { useEffect, useState } from "react";

import type { SlugCheck } from "../api/org";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Поля, которые нужны обоим экранам настроек.
 *
 * Организация и проект настраивают одни и те же величины — рабочие дни,
 * календарь дат, слаг, — и написанные в двух экранах порознь они разъедутся
 * на первой правке: один экран научится понимать пустую строку, другой нет.
 */

/**
 * Маска рабочих дней недели.
 *
 * Нумерация — как на сервере: бит 0 это понедельник. Переводить её в другую
 * нумерацию по дороге значило бы завести второе представление одного и того
 * же, и разъехались бы они на первом же проекте с рабочей субботой.
 */
export function WorkingDaysField({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (mask: number) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();

  return (
    <fieldset className="settings__fieldset">
      <legend>{t("settings.working_days")}</legend>
      <div className="settings__days">
        {[0, 1, 2, 3, 4, 5, 6].map((day) => {
          // Подписи дней недели живут в словарях под номерами `getUTCDay`, где
          // нулевое — воскресенье. Здесь нумерация серверная, поэтому перевод
          // нужен ровно один и ровно здесь.
          const label = t(`calendar.weekday.${(day + 1) % 7}`);
          const on = (value & (1 << day)) !== 0;
          return (
            <label key={day} className="settings__day">
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() => onChange(on ? value & ~(1 << day) : value | (1 << day))}
              />
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Строки в списке дат: пустые отбрасываются, порядок и повторы — забота сервера. */
export function parseDates(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Список дат — праздники и рабочие субботы.
 *
 * Многострочное поле, а не набор датапикеров: праздники вбивают списком раз в
 * год, и десять полей с календариками для этого хуже, чем одно, куда список
 * вставляется целиком.
 */
export function DateListField({
  id,
  label,
  hint,
  value,
  onCommit,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string[];
  onCommit: (dates: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [text, setText] = useState(value.join("\n"));

  // Сервер нормализует список — сортирует и убирает повторы, — и поле обязано
  // показать то, что он вернул, а не то, что человек набрал.
  useEffect(() => setText(value.join("\n")), [value]);

  const broken = parseDates(text).filter((item) => !ISO_DATE.test(item));

  return (
    <p className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <span className="muted">{hint}</span>}
      <textarea
        id={id}
        name={id}
        rows={4}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (broken.length > 0) return;
          const dates = parseDates(text);
          // Порядок в списке ничего не значит: это множество дат.
          if (dates.join(",") !== [...value].join(",")) onCommit(dates);
        }}
      />
      {broken.length > 0 && (
        <span className="error" role="alert">
          {t("settings.bad_dates", { dates: broken.join(", ") })}
        </span>
      )}
    </p>
  );
}

/**
 * Поле слага с подсказкой свободного варианта.
 *
 * Занятость спрашивается у сервера по мере ввода, а не при отправке: раздел 12
 * обещает свободный вариант «прямо в поле ввода до отправки формы». Проверка
 * откладывается на полсекунды после последнего нажатия — иначе запрос уходит
 * на каждую букву и отвечает про недописанное слово.
 */
export function SlugField({
  id,
  label,
  value,
  check,
  onCommit,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  check: (slug: string) => Promise<SlugCheck>;
  onCommit: (slug: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<SlugCheck | null>(null);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    const candidate = draft.trim();
    if (candidate === "" || candidate === value) {
      setStatus(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      check(candidate)
        .then((result) => {
          // Ответ на устаревший запрос игнорируется: человек успел дописать
          // ещё букву, и подсказка про предыдущее слово только запутает.
          if (alive) setStatus(result);
        })
        .catch(() => {
          if (alive) setStatus(null);
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [draft, value, check]);

  const commit = (slug: string) => {
    setDraft(slug);
    if (slug !== value) onCommit(slug);
  };

  return (
    <p className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const candidate = draft.trim();
          if (candidate !== "" && (status === null || status.available)) commit(candidate);
        }}
      />
      {status && !status.available && (
        <span className="settings__slug-hint">
          {t("settings.slug_taken")}{" "}
          {/* Подсказка — кнопка, а не текст: прочитать свободный вариант и
              перепечатать его руками человек может и без нас. */}
          <button type="button" className="button--quiet" onClick={() => commit(status.suggestion)}>
            {status.suggestion}
          </button>
        </span>
      )}
    </p>
  );
}
