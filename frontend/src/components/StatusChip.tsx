import type { TaskStatus } from "../api/projects";

/**
 * Плашка статуса. Подпись приходит готовой: словарь у вызывающих разный
 * (`task.status.*` против «3 заблокированы» на карточке), а цвет — общий,
 * и живёт он в одном месте — в стилях по `data-status`.
 */
export function StatusChip({ status, label }: { status: TaskStatus; label: string }) {
  return (
    <span className="status-chip" data-status={status}>
      {label}
    </span>
  );
}
