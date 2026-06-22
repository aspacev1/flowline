// Статусы, приоритеты — справочники для UI.
// Серверные значения (snake_case enum) совпадают с ключами здесь.

export const STATUSES = {
  todo: { label: "To do", fill: "#A8B3C5" },
  in_progress: { label: "In progress", fill: "#7C95E0" },
  in_review: { label: "In review", fill: "#A98FD1" },
  delayed: { label: "Delayed", fill: "#E0B57A" },
  blocked: { label: "Blocked by", fill: "#E0909F" },
  completed: { label: "Completed", fill: "#82C2A0" },
  archived: { label: "Archived", fill: "#D5D9E0" },
};
export const STATUS_LIST = Object.keys(STATUSES);

export const PRIORITIES = {
  low: { label: "Low", color: "#A8B3C5", filled: false, pulse: false },
  medium: { label: "Medium", color: "#8AA0DE", filled: true, pulse: false },
  high: { label: "High", color: "#E0A571", filled: true, pulse: false },
  critical: { label: "Critical", color: "#D17E8C", filled: true, pulse: true },
};
export const PRIORITY_LIST = Object.keys(PRIORITIES);

export const DAY_WIDTH = 36;
export const ROW_HEIGHT = 44;
export const SUB_ROW_HEIGHT = 38;
export const HOURS_PER_DAY = 8;
