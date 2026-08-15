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
          // Три признака на одной колонке, и порядок между ними разбирает не
          // разметка, а сила селекторов в стилях: сегодняшний день заливается
          // поверх выходного — иначе выходной понедельник теряет метку ровно
          // тогда, когда она нужнее всего.
          className={[
            "gantt__grid-day",
            isWorkingDay(day.date, calendar, day.weekday) ? "" : "is-nonworking",
            // Первое число месяца — граница месяца: линия вдвое толще обычной.
            // Ставится здесь же, где рисуется вся сетка, и потому приходится
            // ровно под такую же границу в шапке.
            day.dayOfMonth === 1 ? "is-month-start" : "",
            day.date === today ? "is-today" : "",
          ]
            .filter(Boolean)
            .join(" ")}
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
        // Линия идёт серединой колонки, а не по её левому краю: на границе
        // между вчера и сегодня непонятно, какой из двух дней она называет,
        // а посередине она однозначно указывает на свой день — и приходится
        // ровно под подпись «сегодня» в шапке.
        <div
          className="gantt__today"
          style={{ left: scale.xOf(today) + scale.dayWidth / 2 }}
          title={todayLabel}
        />
      )}
    </div>
  );
}
