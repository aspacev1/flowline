import { describe, expect, it } from "vitest";

import { DAY_WIDTH, GANTT_DENSITY, ROW_HEIGHT, TASK_HEIGHT, ganttTokens } from "./density";

/**
 * Плотность ленты — договор между расчётами и оформлением.
 *
 * Числа проверяются поимённо не ради самих чисел: они и есть тот масштаб, под
 * который сделана диаграмма, и молчаливая правка одного из них разводит сетку
 * с шапкой, а стрелки связей — со строками. Тест не мешает менять масштаб: он
 * требует, чтобы его меняли здесь и целиком.
 */
describe("плотность ленты", () => {
  it("держит эталонный масштаб", () => {
    expect(GANTT_DENSITY).toEqual({
      dayWidth: { day: 72, week: 44, month: 22 },
      rowHeight: 50,
      taskHeight: 30,
      summaryHeight: 11,
      monthHeaderHeight: 36,
      calendarHeaderHeight: 76,
      weekHeaderHeight: 22,
      toolbarHeight: 56,
      todayMarkerSize: 32,
      gridLineWidth: 1,
    });
  });

  it("оставляет полоске равный просвет сверху и снизу", () => {
    // Полоска стоит по центру строки, и просвет — это остаток. Десять и
    // десять: просветом лента и читается рядом полосок, а не закрашенным
    // полем, поэтому он проверяется наравне с самой полоской.
    expect((ROW_HEIGHT - TASK_HEIGHT) / 2).toBe(10);
    // Полоска занимает две трети строки. Пропорция названа отдельно от чисел:
    // менять их можно, брусом в четыре пятых строки полоска быть не должна.
    expect(TASK_HEIGHT / ROW_HEIGHT).toBeLessThanOrEqual(0.7);
  });

  it("вмещает три недели в области около 930 пикселей", () => {
    // Эталонная плотность недельного масштаба, названная числом: 21 день —
    // это ровно три недели, и на них рассчитана ширина рабочей области.
    expect(Math.floor(930 / DAY_WIDTH.week)).toBe(21);
  });

  it("складывает шапку из полосы месяцев и полосы дней", () => {
    expect(GANTT_DENSITY.monthHeaderHeight + GANTT_DENSITY.calendarHeaderHeight).toBe(112);
    // Строка недель относительной шкалы помещается внутрь полосы дней, а не
    // прибавляется к шапке: угол левой колонки стоит на общей высоте.
    expect(GANTT_DENSITY.weekHeaderHeight).toBeLessThan(GANTT_DENSITY.calendarHeaderHeight);
  });

  it("меняет от масштаба только ширину деления", () => {
    const zooms = ["day", "week", "month"] as const;
    const widths = zooms.map((zoom) => ganttTokens(zoom)["--gantt-day-width" as never]);
    expect(new Set(widths).size).toBe(zooms.length);

    // Всё остальное — высота строки, высота полоски, высоты шапки — от
    // масштаба не зависит: переключение сжимает время, а не перестраивает
    // строки.
    for (const zoom of zooms) {
      const { "--gantt-day-width": _, ...rest } = ganttTokens(zoom) as Record<string, string>;
      expect(rest).toEqual({
        "--gantt-row-height": "50px",
        "--gantt-task-height": "30px",
        "--gantt-summary-height": "11px",
        "--gantt-month-height": "36px",
        "--gantt-days-height": "76px",
        "--gantt-week-height": "22px",
        "--gantt-toolbar-height": "56px",
        "--gantt-today-size": "32px",
        "--gantt-grid-width": "1px",
      });
    }
  });

  it("называет каждую величину плотности переменной для стилей", () => {
    // Ни одно из чисел выше не должно оказаться переписанным в таблицу стилей
    // руками: у каждого есть имя, под которым его читает CSS.
    const names = Object.keys(ganttTokens("week"));
    expect(names).toHaveLength(Object.keys(GANTT_DENSITY).length);
  });
});
