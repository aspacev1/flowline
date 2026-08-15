import type { Calendar } from "../api/projects";
import { relativeMonths, relativeWeeks } from "./relative";
import { isWorkingDay } from "./scale";
import type { Scale } from "./timescale";

/**
 * Шапка ленты: месяцы сверху, дни снизу.
 *
 * Нерабочие дни залиты и здесь тоже, а не только в теле: залитая колонка,
 * обрывающаяся под шапкой, читается как дефект отрисовки, а не как выходной.
 */
export function Header({
  scale,
  calendar,
  today,
  todayLabel,
  monthLabel,
  weekdayLabel,
}: {
  scale: Scale;
  calendar: Calendar;
  /** Сегодняшний день по ISO: его колонка в шапке выделяется. */
  today: string;
  /** Подпись под числом сегодняшнего дня, например «Сегодня». */
  todayLabel: string;
  monthLabel: (iso: string) => string;
  weekdayLabel: (weekday: number) => string;
}) {
  return (
    <div className="gantt__head" style={{ width: scale.width }}>
      <div className="gantt__months">
        {scale.months.map((month) => (
          <div
            key={month.key}
            className="gantt__month"
            style={{ left: month.x, width: month.width }}
          >
            {/* Месяц подписывается по первому своему дню: обрезанный крайний
                месяц всё равно называется своим именем. */}
            <span className="gantt__month-label">{monthLabel(`${month.key}-01`)}</span>
          </div>
        ))}
      </div>

      <div className="gantt__days">
        {scale.days.map((day) => (
          <div
            key={day.date}
            data-day={day.date}
            className={`gantt__day${isWorkingDay(day.date, calendar, day.weekday) ? "" : " is-nonworking"}${
              day.date === today ? " is-today" : ""
            }`}
            style={{ left: day.x, width: scale.dayWidth }}
          >
            {/* День недели над числом, как в макете: мелкая строка сверху,
                число под ней крупнее — и в круге, если день сегодняшний. */}
            <span className="gantt__day-weekday">{weekdayLabel(day.weekday)}</span>
            <span className="gantt__day-number">{day.dayOfMonth}</span>
            {/* Подпись «сегодня» стоит под числом, а не на линии в теле ленты:
                у шапки чип никому не мешает, а на линии он закрывал бы
                полоски задач того дня, ради которого и нарисован. */}
            {day.date === today && <span className="gantt__day-today">{todayLabel}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Шапка относительной шкалы: «Месяц 1» над неделями, «Неделя 1» над днями,
 * в колонках дней — номер дня внутри недели, 1–7.
 *
 * Настоящих дат в этой шапке нет намеренно: ни названий месяцев, ни дней
 * недели, ни метки «сегодня» — план ещё не привязан к календарю, и любая
 * настоящая дата здесь была бы обещанием, которого никто не давал. «Месяц» —
 * визуальная группа из четырёх недель, расчёты идут в днях (см. relative.ts).
 *
 * Заливка нерабочих дней остаётся: маска недели — часть плана и без
 * настоящих дат, и человек должен видеть, что «День 6» его недели — выходной.
 */
export function RelativeHeader({
  scale,
  calendar,
  monthLabel,
  weekLabel,
}: {
  scale: Scale;
  calendar: Calendar;
  monthLabel: (number: number) => string;
  weekLabel: (number: number) => string;
}) {
  return (
    <div className="gantt__head gantt__head--relative" style={{ width: scale.width }}>
      <div className="gantt__months">
        {relativeMonths(scale).map((month) => (
          <div
            key={month.number}
            className="gantt__month"
            style={{ left: month.x, width: month.width }}
          >
            <span className="gantt__month-label">{monthLabel(month.number)}</span>
          </div>
        ))}
      </div>

      <div className="gantt__weeks">
        {relativeWeeks(scale).map((week) => (
          <div
            key={week.number}
            className="gantt__week"
            style={{ left: week.x, width: week.width }}
          >
            <span className="gantt__week-label">{weekLabel(week.number)}</span>
          </div>
        ))}
      </div>

      <div className="gantt__days">
        {scale.days.map((day, index) => (
          <div
            key={day.date}
            data-day={day.date}
            className={`gantt__day${isWorkingDay(day.date, calendar, day.weekday) ? "" : " is-nonworking"}`}
            style={{ left: day.x, width: scale.dayWidth }}
          >
            {/* Номер дня внутри недели, а не от начала проекта: колонка в
                18–52 пикселя вмещает одну-две цифры, и счёт до сотен в ней
                не читается. Неделя названа строкой выше. */}
            <span className="gantt__day-number">{(index % 7) + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
