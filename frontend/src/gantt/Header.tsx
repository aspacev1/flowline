import type { Calendar } from "../api/projects";
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
            {/* День недели над числом, как в макете: курсивная строка сверху —
                примета набора Broadsheet, и число под ней читается крупнее. */}
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
