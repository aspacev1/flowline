import type { Calendar } from "../api/projects";
import { isWorkingDay } from "./scale";
import type { Scale } from "./timescale";

/**
 * Фон ленты: колонки дней, заливка нерабочих, вертикали дедлайна и сегодня.
 *
 * Сетка строится один раз на всю диаграмму и растягивается по высоте, а не
 * повторяется в каждой строке. На сотне задач и сотне дней повторение дало бы
 * десять тысяч узлов ради картинки, которая во всех строках одинакова.
 *
 * Для чтения с экрана она невидима: это фон, и перечислять сто дат подряд
 * человеку, слушающему страницу, незачем — даты задачи он узнает из её
 * полоски.
 */
export function Grid({
  scale,
  calendar,
  deadline,
  today,
  deadlineLabel,
  todayLabel,
}: {
  scale: Scale;
  calendar: Calendar;
  deadline: string | null;
  today: string;
  deadlineLabel: string;
  todayLabel: string;
}) {
  const withinWindow = (date: string) => date >= scale.from && date <= scale.to;

  return (
    <div className="gantt__grid" style={{ width: scale.width }} aria-hidden="true">
      {scale.days.map((day) => (
        <div
          key={day.date}
          data-day={day.date}
          className={`gantt__grid-day${isWorkingDay(day.date, calendar, day.weekday) ? "" : " is-nonworking"}`}
          style={{ left: day.x, width: scale.dayWidth }}
        />
      ))}

      {deadline && withinWindow(deadline) && (
        <div
          className="gantt__deadline"
          style={{ left: scale.xOf(deadline) + scale.dayWidth }}
          title={deadlineLabel}
        />
      )}

      {withinWindow(today) && (
        <div className="gantt__today" style={{ left: scale.xOf(today) }} title={todayLabel} />
      )}
    </div>
  );
}
