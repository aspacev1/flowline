import { useEffect, useState } from "react";
import type { PointerEvent } from "react";

import type { ProjectState } from "../api/projects";
import { reorderTask } from "../project/optimistic";
import { useProjectMutation } from "../project/useProjectMutation";

/**
 * Перестановка строк перетаскиванием за левую колонку.
 *
 * Жестов два, и они разделены нарочно: полоску тащат по горизонтали и меняют
 * даты, строку тащат за ручку и меняют порядок. Одно движение — одно
 * последствие. Смешать их значило бы сбивать сроки каждому, кто попытался
 * переставить строку и промахнулся вниз на пиксель.
 *
 * Клиент шлёт только целевую позицию и категорию: раздвинуть соседей и записать
 * их сдвиги в журнал — дело сервера, и вторая реализация того же расчёта здесь
 * разошлась бы с ней на первом же переносе между категориями.
 */

export type DropTarget = { kind: "task" | "category"; id: string; half: "top" | "bottom" };

/** Верхняя половина строки или нижняя — от настоящих границ, а не от индекса. */
export function halfOf(event: PointerEvent<HTMLElement>): "top" | "bottom" {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY < box.top + box.height / 2 ? "top" : "bottom";
}

function byOrder<T extends { position: number; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
}

/** Куда встанет строка, если её отпустить здесь. */
function placeFor(
  state: ProjectState,
  taskId: string,
  target: DropTarget,
): { categoryId: string; position: number } | null {
  if (target.kind === "category") {
    // Бросок на заголовок — это «положи в эту категорию», а не выбор места
    // внутри неё: место выбирают, целясь между строками.
    return {
      categoryId: target.id,
      position: state.tasks.filter((row) => row.category_id === target.id && row.id !== taskId)
        .length,
    };
  }

  const over = state.tasks.find((row) => row.id === target.id);
  if (!over) return null;

  const siblings = byOrder(
    state.tasks.filter((row) => row.category_id === over.category_id && row.id !== taskId),
  );
  const index = siblings.findIndex((row) => row.id === over.id);
  if (index === -1) return null;

  return { categoryId: over.category_id, position: target.half === "top" ? index : index + 1 };
}

export function useReorder({
  projectId,
  state,
  canWrite,
}: {
  projectId: string;
  state: ProjectState;
  canWrite: boolean;
}) {
  const { apply } = useProjectMutation(projectId);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);

  // Отпустить кнопку можно и мимо строк — за краем ленты, над шапкой, вообще
  // вне окна. Без этого слушателя строка осталась бы «в руке» навсегда, и
  // следующее движение мыши переставляло бы её без всякого нажатия.
  useEffect(() => {
    if (taskId === null) return;
    const finish = () => {
      setTaskId(null);
      setTarget(null);
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [taskId]);

  return {
    /** Показывать ли ручки перетаскивания. У гостя их нет вовсе. */
    enabled: canWrite,
    /** Идёт ли перестановка прямо сейчас. */
    active: taskId !== null,

    start(id: string) {
      if (!canWrite) return;
      setTaskId(id);
      setTarget(null);
    },

    over(next: DropTarget) {
      if (taskId === null) return;
      // Над самой собой линия вставки не рисуется: она обещала бы перемещение
      // туда, где строка и так стоит.
      setTarget(next.kind === "task" && next.id === taskId ? null : next);
    },

    drop() {
      if (taskId === null) return;
      const dragged = taskId;
      const spot = target;
      setTaskId(null);
      setTarget(null);
      if (spot === null) return;

      const place = placeFor(state, dragged, spot);
      if (place === null) return;

      // Строка, вернувшаяся на своё место, — не изменение: сравниваем не
      // индексы, а весь порядок после перестановки. Индексы сравнивать нельзя,
      // потому что одна и та же позиция считается по-разному в зависимости от
      // того, откуда пришла строка.
      const next = reorderTask(state, dragged, place.categoryId, place.position);
      const unchanged = next.tasks.every((row) => {
        const before = state.tasks.find((old) => old.id === row.id);
        return (
          before !== undefined &&
          before.position === row.position &&
          before.category_id === row.category_id
        );
      });
      if (unchanged) return;

      void apply(
        {
          type: "reorder_task",
          task_id: dragged,
          category_id: place.categoryId,
          position: place.position,
        },
        (current) => reorderTask(current, dragged, place.categoryId, place.position),
      ).catch(() => {
        // Откат уже сделан внутри `apply`: строка вернулась туда, откуда её
        // взяли, и это и есть ответ на отказ.
      });
    },

    /** Класс линии вставки для этой строки, если курсор сейчас над ней. */
    markFor(kind: "task" | "category", id: string): string {
      if (target === null || target.kind !== kind || target.id !== id) return "";
      if (kind === "category") return "drop-into";
      return target.half === "top" ? "drop-before" : "drop-after";
    },
  };
}

export type Reorder = ReturnType<typeof useReorder>;
