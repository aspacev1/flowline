import type { Dependency, Task } from "../api/projects";
import { ROW_HEIGHT } from "./scale";
import type { Scale } from "./timescale";

/**
 * Слой стрелок между связанными задачами.
 *
 * Связи по спецификации — картинка, а не правило расчёта: даты по ним не
 * пересчитываются. Поэтому слой ничего не знает о домене и только соединяет
 * конец одной полоски с началом другой.
 *
 * Координаты берутся из шкалы и из порядка строк, а не измеряются у DOM.
 * Причина не в удобстве: полоски стоят там, куда их поставила та же шкала, и
 * измерять то, что мы сами и вычислили, значит получить второй источник правды,
 * который расходится с первым при каждой перерисовке — ровно то, из-за чего
 * стрелки уезжают. Высота строки в CSS задаётся отсюда же (см. ROW_HEIGHT),
 * так что расходиться нечему.
 */

/** Отступ, на который стрелка отходит от полоски, прежде чем повернуть. */
const ELBOW = 8;

export function Arrows({
  scale,
  tasks,
  dependencies,
  rowOf,
  rows,
}: {
  scale: Scale;
  tasks: Task[];
  dependencies: Dependency[];
  /** Номер строки задачи в ленте, считая строки категорий. */
  rowOf: Map<string, number>;
  /** Сколько всего строк в ленте. */
  rows: number;
}) {
  const byId = new Map(tasks.map((task) => [task.id, task]));

  const lines = dependencies
    .map((link) => {
      const from = byId.get(link.from_task_id);
      const to = byId.get(link.to_task_id);
      const fromRow = rowOf.get(link.from_task_id);
      const toRow = rowOf.get(link.to_task_id);
      // Связь переживает задачу ровно на один ответ сервера — задачу могли
      // удалить в соседней вкладке. Стрелка в пустоту уходит в NaN и уносит с
      // собой весь слой, поэтому такая связь просто не рисуется.
      if (!from || !to || fromRow === undefined || toRow === undefined) return null;

      const startX = scale.xOf(from.start_date) + scale.widthOf(from.start_date, from.end_date);
      const startY = fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
      const endX = scale.xOf(to.start_date);
      const endY = toRow * ROW_HEIGHT + ROW_HEIGHT / 2;

      return {
        key: `${link.from_task_id}-${link.to_task_id}`,
        // Линия не доходит до полоски на размер наконечника: остриё, лежащее
        // поверх линии, рисовало бы утолщение вместо стрелки.
        points: elbow(startX, startY, endX - 4, endY),
        head: `M${endX - 6} ${endY - 4} L${endX} ${endY} L${endX - 6} ${endY + 4} Z`,
        // Нарушенная связь: приёмник начат, пока источник ещё не кончился.
        // Конец отрезка включительный, поэтому совпадение дат — тоже нахлёст.
        violated: to.start_date <= from.end_date,
      };
    })
    .filter((line) => line !== null);

  return (
    // Скрыто от чтения с экрана: связь — это оформление, а не сведения. Их
    // место в карточке задачи, списком, а не в виде картинки, которую нечем
    // прочесть.
    <svg
      className="arrows"
      width={scale.width}
      height={rows * ROW_HEIGHT}
      aria-hidden="true"
      focusable="false"
    >
      {lines.map((line) => (
        <g key={line.key} className={line.violated ? "is-violated" : undefined}>
          <polyline points={line.points} className={line.violated ? "is-violated" : undefined} />
          {/* Наконечник — сплошной треугольник остриём в начало полоски:
              линия без него не говорит, кто кого ждёт. Входит всегда
              горизонтально слева — ломаная кончается этим же направлением. */}
          <path className="arrows__head" d={line.head} />
        </g>
      ))}
    </svg>
  );
}

/**
 * Ломаная от конца одной полоски к началу другой.
 *
 * Прямая линия наискось пересекала бы чужие полоски и читалась бы хуже угла:
 * на диаграмме, где всё стоит по сетке, диагональ выглядит случайной.
 */
function elbow(startX: number, startY: number, endX: number, endY: number): string {
  const points: number[][] = [[startX, startY]];

  if (endX >= startX + ELBOW * 2) {
    // Есть куда повернуть: выходим вправо, идём вниз, входим слева.
    points.push([startX + ELBOW, startY], [startX + ELBOW, endY]);
  } else {
    // Задача-приёмник начинается раньше, чем кончается источник: обходим её
    // по промежутку между строками, иначе линия шла бы поверх обеих полосок.
    const between = (startY + endY) / 2;
    points.push(
      [startX + ELBOW, startY],
      [startX + ELBOW, between],
      [endX - ELBOW, between],
      [endX - ELBOW, endY],
    );
  }

  points.push([endX, endY]);
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}
