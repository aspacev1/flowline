import { useEffect, useMemo, useRef } from "react";

import type { Category, ProjectState, Task } from "../api/projects";
import { useLocale } from "../i18n/LocaleProvider";
import { Grid } from "./Grid";
import { Header } from "./Header";
import { CategoryRow, TaskRow } from "./Row";
import { DAY_WIDTH, projectWindow } from "./scale";
import { buildScale, daysBetween, toISO } from "./timescale";

import "./gantt.css";

/**
 * Порядок строк — по позиции, а при равенстве по идентификатору.
 *
 * Второй ключ не перестраховка: позиции совпадают в одном настоящем случае —
 * строка, восстановленная отменой на место, которое с тех пор занял сосед. Без
 * него порядок между двумя перерисовками неустойчив, и строки прыгают местами
 * сами по себе.
 */
function byPosition<T extends { position: number; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function Gantt({ state }: { state: ProjectState }) {
  const { locale, t } = useLocale();
  const scroller = useRef<HTMLDivElement>(null);

  const today = toISO(Date.now());
  const scale = useMemo(() => {
    const { from, to } = projectWindow(state);
    return buildScale({ from, to, dayWidth: DAY_WIDTH });
  }, [state]);

  const formats = useMemo(
    () => ({
      // timeZone: UTC — тот же принцип, что и в шкале: дата без времени,
      // отформатированная в местном поясе, к западу от Гринвича называется
      // вчерашним числом.
      day: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }),
      month: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }),
    }),
    [locale],
  );

  const formatDay = (iso: string) => formats.day.format(new Date(`${iso}T00:00:00Z`));

  // Прокрутка к сегодняшнему дню при открытии: проект длиной в квартал иначе
  // открывается на своём начале, то есть на том, что уже сделано.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (today < scale.from || today > scale.to) return;
    element.scrollLeft = Math.max(0, scale.xOf(today) - DAY_WIDTH * 3);
  }, [scale, today]);

  const categories = byPosition(state.categories);
  const tasksByCategory = new Map<string, Task[]>();
  for (const task of byPosition(state.tasks)) {
    const bucket = tasksByCategory.get(task.category_id);
    if (bucket) bucket.push(task);
    else tasksByCategory.set(task.category_id, [task]);
  }

  const isLate = (task: Task) => state.deadline !== null && task.end_date > state.deadline;

  return (
    <div className="gantt">
      <Summary state={state} formatDay={formatDay} />

      {categories.length === 0 ? (
        <p className="empty gantt__empty">{t("gantt.empty")}</p>
      ) : (
        <div className="gantt__scroll" ref={scroller}>
          <div className="gantt__canvas">
            <div className="gantt__head-row">
              <div className="gantt__label gantt__corner" />
              <Header
                scale={scale}
                calendar={state.calendar}
                monthLabel={(iso) => formats.month.format(new Date(`${iso}T00:00:00Z`))}
                weekdayLabel={(weekday) =>
                  // 4 января 2026 — воскресенье, то есть нулевой день недели.
                  // Опорная неделя вместо словаря из семи ключей на язык:
                  // названия дней платформа знает лучше, чем мы их перепишем.
                  formats.weekday.format(new Date(Date.UTC(2026, 0, 4 + weekday)))
                }
              />
            </div>

            <div className="gantt__body">
              <Grid
                scale={scale}
                calendar={state.calendar}
                deadline={state.deadline}
                today={today}
                deadlineLabel={
                  state.deadline ? t("gantt.deadline", { date: formatDay(state.deadline) }) : ""
                }
                todayLabel={t("gantt.today")}
              />

              <div className="gantt__rows">
                {categories.map((category: Category) => {
                  const tasks = tasksByCategory.get(category.id) ?? [];
                  return (
                    <div key={category.id} className="gantt__group">
                      <CategoryRow category={category} tasks={tasks} scale={scale} />
                      {tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          scale={scale}
                          late={isLate(task)}
                          lateLabel={t("gantt.late")}
                          title={`${formatDay(task.start_date)} — ${formatDay(task.end_date)}`}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Плашка с итогом по дедлайну.
 *
 * Единственная цифра, которая по-настоящему интересует заказчика, поэтому она
 * висит постоянно, а не появляется по наведению. Без дедлайна плашки нет:
 * писать «успеваем» там, где успевать не к чему, — это выдумывать смысл.
 */
function Summary({
  state,
  formatDay,
}: {
  state: ProjectState;
  formatDay: (iso: string) => string;
}) {
  const { t } = useLocale();
  if (state.deadline === null || state.project_end === null) return null;

  const overrun = daysBetween(state.deadline, state.project_end);
  const params = {
    end: formatDay(state.project_end),
    deadline: formatDay(state.deadline),
    days: t("common.days", { count: Math.abs(overrun) }),
  };

  return (
    <p className={`gantt__summary${overrun > 0 ? " is-late" : " is-fine"}`}>
      {overrun > 0 ? t("gantt.summary.late", params) : t("gantt.summary.fits", params)}
    </p>
  );
}
