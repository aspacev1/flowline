import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Plus, ChevronLeft, X, Trash2, Flag } from "lucide-react";
import { api } from "../api.js";
import {
  STATUSES,
  STATUS_LIST,
  PRIORITIES,
  PRIORITY_LIST,
  DAY_WIDTH,
  ROW_HEIGHT,
  SUB_ROW_HEIGHT,
  HOURS_PER_DAY,
} from "../constants.js";
import {
  today,
  addDays,
  daysBetween,
  fmtDate,
  isoDate,
  workEndDate,
  workDaysBetween,
  currentEndDate,
  isOverEstimate,
  isExtended,
  extensionDays,
} from "../dateUtils.js";

// ============================================================
// Small shared UI bits
// ============================================================

function StatusDot({ status }) {
  const s = STATUSES[status];
  return <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.fill }} title={s.label} />;
}

function PriorityIcon({ priority, size = 12 }) {
  const p = PRIORITIES[priority];
  return (
    <Flag
      size={size}
      style={{ color: p.color }}
      fill={p.filled ? p.color : "none"}
      strokeWidth={2}
      className={p.pulse ? "animate-pulse" : ""}
    />
  );
}

function StatusBadge({ status }) {
  const s = STATUSES[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ backgroundColor: `${s.fill}1F`, color: s.fill }}
    >
      <StatusDot status={status} />
      {s.label}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const p = PRIORITIES[priority];
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border"
      style={{ borderColor: p.color, color: p.color }}
    >
      <PriorityIcon priority={priority} size={11} />
      {p.label}
    </span>
  );
}

function SelectPills({ value, onChange, options, renderOption }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`transition-opacity ${value === key ? "opacity-100" : "opacity-45 hover:opacity-75"}`}
        >
          {renderOption(key)}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// Flatten tasks + subtasks for rendering
// ============================================================

function flattenWork(items, expanded) {
  const tasks = items.filter((i) => i.kind === "task");
  const rows = [];
  for (const task of tasks) {
    const subtasks = items.filter((i) => i.kind === "subtask" && i.parentId === task.id);
    rows.push({ ...task, isSubtask: false, subtasks });
    if (expanded[task.id] && subtasks.length) {
      for (const sub of subtasks) rows.push({ ...sub, isSubtask: true });
    }
  }
  return rows;
}

// ============================================================
// Sidebar
// ============================================================

function TaskSidebar({ rows, people, onSelect, selectedId, onDeleteTask, expanded, onToggleExpand }) {
  return (
    <div className="shrink-0 w-[280px] border-r border-slate-200 bg-white">
      <div
        className="flex items-center px-4 border-b border-slate-200 text-[11px] font-semibold text-slate-400 uppercase tracking-wide"
        style={{ height: 52 }}
      >
        Задача
      </div>
      {rows.map((row, i) => {
        const person = people.find((p) => p.id === row.assignee);
        const hasSubtasks = !row.isSubtask && row.subtasks?.length > 0;
        const isExpandedRow = expanded[row.id];
        const isSelected = selectedId === row.id;
        const zebraBg = i % 2 === 1 ? "bg-slate-50/60" : "bg-white";
        return (
          <div
            key={row.id}
            onClick={() => onSelect(row.id)}
            className={`group flex items-center gap-2 px-4 cursor-pointer border-b border-slate-100 transition-colors ${
              isSelected ? "bg-indigo-50" : `${zebraBg} hover:bg-slate-100`
            } ${row.isSubtask ? "pl-9" : ""}`}
            style={{ height: row.isSubtask ? SUB_ROW_HEIGHT : ROW_HEIGHT }}
          >
            {hasSubtasks ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand(row.id);
                }}
                className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 shrink-0"
              >
                <span className={`transition-transform inline-block ${isExpandedRow ? "rotate-90" : ""}`}>▸</span>
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}

            <StatusDot status={row.status} />
            <PriorityIcon priority={row.priority} size={11} />

            {person && (
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-semibold text-white shrink-0"
                style={{ backgroundColor: person.color }}
                title={`${person.name} · ${person.department?.name ?? "без отдела"}`}
              >
                {person.initials}
              </div>
            )}
            <span className={`truncate flex-1 ${row.isSubtask ? "text-[12px] text-slate-600" : "text-[13px] text-slate-700"}`}>
              {row.name}
            </span>
            <span
              className={`text-[11px] shrink-0 tabular-nums ${
                isOverEstimate(row) ? "text-rose-600 font-semibold" : "text-slate-400"
              }`}
              title={`${row.loggedHours}ч потрачено из плана ${row.duration}д (${row.duration * HOURS_PER_DAY}ч)`}
            >
              {row.loggedHours}ч / {row.duration}д
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteTask(row.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition-opacity shrink-0"
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Gantt grid
// ============================================================

function GanttGrid({ rows, people, rangeStart, totalDays, onDragEnd, selectedId, onSelect }) {
  const dragRef = useRef(null);
  const [liveOverride, setLiveOverride] = useState(null);

  const dayLabels = useMemo(() => {
    const labels = [];
    for (let i = 0; i < totalDays; i++) labels.push(addDays(rangeStart, i));
    return labels;
  }, [rangeStart, totalDays]);

  const displayRows = useMemo(() => {
    if (!liveOverride) return rows;
    return rows.map((r) =>
      r.id === liveOverride.rowId ? { ...r, start: liveOverride.start, duration: liveOverride.duration } : r
    );
  }, [rows, liveOverride]);

  const rowHeights = displayRows.map((r) => (r.isSubtask ? SUB_ROW_HEIGHT : ROW_HEIGHT));
  const totalHeight = rowHeights.reduce((a, b) => a + b, 0);
  const rowTops = useMemo(() => {
    const tops = [];
    let acc = 0;
    for (const h of rowHeights) {
      tops.push(acc);
      acc += h;
    }
    return tops;
  }, [rowHeights]);

  const rowIndexById = useMemo(() => {
    const m = {};
    displayRows.forEach((r, i) => (m[r.id] = i));
    return m;
  }, [displayRows]);

  const handleMouseDown = (e, row, mode) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    dragRef.current = {
      rowId: row.id,
      isSubtask: row.isSubtask,
      mode,
      startX,
      originalStart: new Date(row.start),
      originalDuration: row.duration,
    };

    const handleMouseMove = (ev) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dayDelta = Math.round(dx / DAY_WIDTH);
      if (dragRef.current.mode === "move") {
        setLiveOverride({
          rowId: dragRef.current.rowId,
          start: addDays(dragRef.current.originalStart, dayDelta),
          duration: dragRef.current.originalDuration,
        });
      } else {
        const originalEnd = currentEndDate({
          start: dragRef.current.originalStart,
          duration: dragRef.current.originalDuration,
        });
        const newEndDate = addDays(originalEnd, dayDelta);
        const newDuration = Math.max(1, workDaysBetween(dragRef.current.originalStart, newEndDate));
        setLiveOverride({
          rowId: dragRef.current.rowId,
          start: dragRef.current.originalStart,
          duration: newDuration,
        });
      }
    };
    const handleMouseUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      if (!drag) return;

      setLiveOverride((current) => {
        if (current && current.rowId === drag.rowId) {
          onDragEnd(drag.rowId, drag.isSubtask, current.start, current.duration, drag.originalStart, drag.originalDuration);
        }
        return null;
      });
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const todayOffset = daysBetween(rangeStart, today);

  return (
    <div className="relative" style={{ width: totalDays * DAY_WIDTH }}>
      <div className="flex border-b border-slate-200 bg-white sticky top-0 z-20" style={{ height: 52 }}>
        {dayLabels.map((d, i) => {
          const isWeekendDay = d.getDay() === 0 || d.getDay() === 6;
          const isFirstOfMonth = d.getDate() === 1 || i === 0;
          return (
            <div
              key={i}
              className={`relative shrink-0 flex flex-col items-center justify-center border-r border-slate-100 ${
                isWeekendDay ? "bg-slate-50" : ""
              }`}
              style={{ width: DAY_WIDTH }}
            >
              {isFirstOfMonth && (
                <span className="absolute text-[10px] font-medium text-slate-400" style={{ top: 4 }}>
                  {d.toLocaleDateString("ru-RU", { month: "short" })}
                </span>
              )}
              <span className="text-[11px] text-slate-500 leading-none mt-2.5">{d.getDate()}</span>
              <span className="text-[9px] text-slate-400 leading-none mt-0.5">
                {d.toLocaleDateString("ru-RU", { weekday: "narrow" })}
              </span>
            </div>
          );
        })}
      </div>

      <div className="relative" style={{ height: totalHeight }}>
        <div className="absolute inset-0 pointer-events-none">
          {displayRows.map((row, i) =>
            i % 2 === 1 ? (
              <div
                key={row.id}
                className="absolute left-0 right-0 bg-slate-100/60"
                style={{ top: rowTops[i], height: rowHeights[i] }}
              />
            ) : null
          )}
        </div>

        <div className="absolute inset-0 flex pointer-events-none">
          {dayLabels.map((d, i) => {
            const isWeekendDay = d.getDay() === 0 || d.getDay() === 6;
            return <div key={i} className={isWeekendDay ? "bg-slate-50/70" : ""} style={{ width: DAY_WIDTH, height: totalHeight }} />;
          })}
        </div>

        {todayOffset >= 0 && todayOffset < totalDays && (
          <div className="absolute top-0 w-[2px] bg-rose-400 z-10" style={{ left: todayOffset * DAY_WIDTH, height: totalHeight }}>
            <div className="absolute -top-[6px] -left-[6px] w-3.5 h-3.5 rounded-full bg-rose-400 border-2 border-white" />
          </div>
        )}

        <svg className="absolute top-0 left-0 pointer-events-none z-10" width={totalDays * DAY_WIDTH} height={totalHeight}>
          {displayRows.flatMap((row) =>
            (row.deps || []).map((depId) => {
              const depIdx = rowIndexById[depId];
              if (depIdx === undefined) return null;
              const dep = displayRows[depIdx];
              const toIdx = rowIndexById[row.id];
              const depEndOffset = daysBetween(rangeStart, currentEndDate(dep)) + 1;
              const fromX = depEndOffset * DAY_WIDTH;
              const fromY = rowTops[depIdx] + rowHeights[depIdx] / 2;
              const toX = daysBetween(rangeStart, row.start) * DAY_WIDTH;
              const toY = rowTops[toIdx] + rowHeights[toIdx] / 2;
              const midX = (fromX + toX) / 2;
              return (
                <path
                  key={`${dep.id}-${row.id}`}
                  d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`}
                  stroke="#CBD2E0"
                  strokeWidth="1.5"
                  fill="none"
                />
              );
            })
          )}
        </svg>

        {displayRows.map((row, i) => {
          const left = daysBetween(rangeStart, row.start) * DAY_WIDTH;
          const rowEndDate = currentEndDate(row);
          const calendarSpanDays = daysBetween(row.start, rowEndDate) + 1;
          const width = calendarSpanDays * DAY_WIDTH;
          const person = people.find((p) => p.id === row.assignee);
          const isSelected = selectedId === row.id;
          const status = STATUSES[row.status];
          const priority = PRIORITIES[row.priority];
          const barHeight = row.isSubtask ? 22 : 28;
          const overBudget = isOverEstimate(row);
          const extended = isExtended(row);
          const workedSoFar =
            today <= new Date(row.start) ? 0 : Math.min(workDaysBetween(row.start, addDays(today, -1)), row.duration);
          const filledWidthPx =
            workedSoFar <= 0 ? 0 : (daysBetween(row.start, workEndDate(row.start, workedSoFar)) + 1) * DAY_WIDTH;
          const originalEndOffsetPx = extended ? daysBetween(row.start, row.originalEndDate) * DAY_WIDTH : null;

          return (
            <div key={row.id} className="absolute left-0 right-0 border-b border-slate-100" style={{ top: rowTops[i], height: rowHeights[i] }}>
              <div
                className="absolute top-1/2 -translate-y-1/2 flex items-center gap-1 z-20"
                style={{ left: Math.max(left - 42, 2), width: 40, height: barHeight, justifyContent: "flex-end" }}
              >
                {person && (
                  <div
                    className="rounded-full flex items-center justify-center text-white font-semibold shrink-0 border border-white/60"
                    style={{
                      backgroundColor: person.color,
                      width: row.isSubtask ? 16 : 18,
                      height: row.isSubtask ? 16 : 18,
                      fontSize: row.isSubtask ? 7 : 7.5,
                    }}
                    title={`Ответственный: ${person.name}`}
                  >
                    {person.initials}
                  </div>
                )}
                <span title={`Приоритет: ${priority.label}`} className="flex items-center shrink-0">
                  <PriorityIcon priority={row.priority} size={row.isSubtask ? 12 : 14} />
                </span>
              </div>

              <div
                onClick={() => onSelect(row.id)}
                onMouseDown={(e) => handleMouseDown(e, row, "move")}
                className={`absolute top-1/2 -translate-y-1/2 rounded-lg cursor-grab active:cursor-grabbing flex items-center group transition-shadow z-20 overflow-hidden ${
                  isSelected ? "ring-2 ring-offset-1 ring-indigo-300" : ""
                }`}
                style={{
                  left,
                  width: Math.max(width, 24),
                  height: barHeight,
                  backgroundColor: `${status.fill}26`,
                  border: `1.5px solid ${status.fill}`,
                  outline: overBudget ? "2px solid #DC2F4E" : "none",
                  outlineOffset: overBudget ? "1px" : "0",
                }}
                title={`${row.name}${overBudget ? ` — перерасход: ${row.loggedHours}ч факт против плана ${row.duration * HOURS_PER_DAY}ч` : ""}`}
              >
                {filledWidthPx > 0 && (
                  <div className="absolute top-0 left-0 bottom-0 z-0" style={{ width: filledWidthPx, backgroundColor: status.fill }} />
                )}

                {extended && originalEndOffsetPx !== null && originalEndOffsetPx < width && (
                  <div
                    className="absolute top-0 bottom-0 z-10"
                    style={{
                      left: Math.max(originalEndOffsetPx, 0),
                      width: width - Math.max(originalEndOffsetPx, 0),
                      backgroundImage:
                        "repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0px, rgba(255,255,255,0.35) 3px, transparent 3px, transparent 7px)",
                      borderLeft: "2px dashed #E8A33D",
                    }}
                  />
                )}

                {overBudget && (
                  <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-rose-600 border-2 border-white flex items-center justify-center z-30">
                    <span className="text-white text-[8px] font-bold leading-none">!</span>
                  </div>
                )}
                {extended && (
                  <div className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-white flex items-center justify-center z-30">
                    <span className="text-white text-[8px] font-bold leading-none">→</span>
                  </div>
                )}
                <div
                  onMouseDown={(e) => handleMouseDown(e, row, "resize")}
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/10 rounded-r-lg z-10"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// History tab
// ============================================================

function HistoryTab({ workItemId }) {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    api
      .getWorkItemHistory(workItemId)
      .then(({ history }) => setEntries(history))
      .catch(() => setEntries([]));
  }, [workItemId]);

  if (entries === null) {
    return (
      <div className="p-5 flex-1 flex items-center justify-center">
        <p className="text-[12.5px] text-slate-400">Загрузка истории…</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="p-5 flex-1 flex items-center justify-center">
        <p className="text-[12.5px] text-slate-400 text-center">
          Пока нет изменений.
          <br />
          История появится здесь после первой правки.
        </p>
      </div>
    );
  }

  return (
    <div className="p-5 flex-1 overflow-y-auto">
      <div className="space-y-3">
        {entries.map((entry) => (
          <div key={entry.id} className="flex gap-2.5">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold text-white shrink-0 mt-0.5"
              style={{ backgroundColor: entry.changedBy?.color ?? "#94A3B8" }}
            >
              {entry.changedBy?.initials ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] text-slate-700">
                <span className="font-medium">{entry.changedBy?.name ?? "Неизвестный"}</span> изменил «{entry.fieldLabel}»
              </p>
              <p className="text-[12px] text-slate-400 mt-0.5">
                <span className="line-through text-slate-400">{entry.oldValue ?? "—"}</span>
                {" → "}
                <span className="text-slate-600 font-medium">{entry.newValue ?? "—"}</span>
              </p>
              <p className="text-[11px] text-slate-300 mt-0.5">
                {new Date(entry.changedAt).toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Task detail panel
// ============================================================

function TaskDetailPanel({ row, people, onClose, onUpdate, onDelete }) {
  const [activeTab, setActiveTab] = useState("details");
  if (!row) return null;
  const endDate = currentEndDate(row);

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[360px] bg-white border-l border-slate-200 shadow-2xl z-30 flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <span className="text-[13px] font-semibold text-slate-400 uppercase tracking-wide">
          {row.isSubtask ? "Подзадача" : "Задача"}
        </span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X size={18} />
        </button>
      </div>

      <div className="flex border-b border-slate-100 px-5">
        {[
          { key: "details", label: "Детали" },
          { key: "history", label: "История" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2.5 text-[12.5px] font-medium border-b-2 transition-colors ${
              activeTab === tab.key ? "border-indigo-500 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "history" ? (
        <HistoryTab workItemId={row.id} />
      ) : (
        <div className="p-5 flex-1 overflow-y-auto space-y-5">
          <div>
            <label className="text-[11.5px] font-medium text-slate-500 mb-2 block">Задача</label>
            <div className="h-9 px-2 flex items-center gap-2 bg-slate-50 rounded-lg">
              <PriorityIcon priority={row.priority} size={14} />
              <div className="h-7 flex-1 rounded-lg flex items-center px-3" style={{ backgroundColor: STATUSES[row.status].fill }}>
                <input
                  value={row.name}
                  onChange={(e) => onUpdate({ name: e.target.value })}
                  className="w-full bg-transparent text-[12.5px] font-medium truncate focus:outline-none"
                  style={{ color: ["todo", "archived"].includes(row.status) ? "#1A1D23" : "#FFFFFF" }}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11.5px] font-medium text-slate-500 mb-1.5 block">Начало</label>
              <input
                type="date"
                value={isoDate(row.start)}
                onChange={(e) => onUpdate({ start: new Date(e.target.value) })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div>
              <label className="text-[11.5px] font-medium text-slate-500 mb-1.5 block">Запланировано</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  value={row.duration}
                  onChange={(e) => onUpdate({ duration: Math.max(1, Number(e.target.value)) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <span className="text-[12px] text-slate-400 shrink-0">раб. дн.</span>
              </div>
            </div>
          </div>

          <p className="text-[12px] text-slate-400 flex items-center gap-1.5 flex-wrap">
            Завершение: {fmtDate(endDate)}
            {isExtended(row) && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                продлено с {fmtDate(row.originalEndDate)} (+{extensionDays(row)} {extensionDays(row) === 1 ? "день" : "дня"})
              </span>
            )}
          </p>

          <div>
            <label className="text-[11.5px] font-medium text-slate-500 mb-1.5 block">Потрачено</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                value={row.loggedHours}
                onChange={(e) => onUpdate({ loggedHours: Math.max(0, Number(e.target.value)) })}
                className={`w-28 px-3 py-2 rounded-lg border text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                  isOverEstimate(row) ? "border-rose-300 text-rose-600 font-medium" : "border-slate-200 text-slate-900"
                }`}
              />
              <span className="text-[12px] text-slate-400 shrink-0">ч.</span>
            </div>
            <p className={`text-[12px] mt-1.5 flex items-center gap-1.5 ${isOverEstimate(row) ? "text-rose-600" : "text-slate-400"}`}>
              {isOverEstimate(row) && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />}
              План: {row.duration * HOURS_PER_DAY}ч ({row.duration}д × {HOURS_PER_DAY}ч).{" "}
              {isOverEstimate(row) ? "Затрачено больше плана" : "В рамках плана"}
            </p>
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-slate-500 mb-2 block">Статус</label>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_LIST.map((key) => {
                const s = STATUSES[key];
                const active = row.status === key;
                return (
                  <button
                    key={key}
                    onClick={() => onUpdate({ status: key })}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full transition-colors"
                    style={active ? { backgroundColor: `${s.fill}1F`, color: s.fill } : { backgroundColor: "#F1F2F4", color: "#94A3B8" }}
                  >
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: active ? s.fill : "#C2C7D0" }} />
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-slate-500 mb-2 block">
              Приоритет <span className="text-slate-300">— флажок слева от бара</span>
            </label>
            <SelectPills value={row.priority} onChange={(v) => onUpdate({ priority: v })} options={PRIORITY_LIST} renderOption={(key) => <PriorityBadge priority={key} />} />
          </div>

          <div>
            <label className="text-[11.5px] font-medium text-slate-500 mb-1.5 block">
              {row.isSubtask ? "Исполнитель" : "Ответственный"}
            </label>

            {row.isSubtask ? (
              <div className="flex flex-wrap gap-2">
                {people.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onUpdate({ assignee: p.id })}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[12px] font-medium transition-colors ${
                      row.assignee === p.id ? "border-transparent text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                    style={row.assignee === p.id ? { backgroundColor: p.color } : {}}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-2.5">
                {Object.entries(
                  people.reduce((acc, p) => {
                    const key = p.department?.id || "none";
                    if (!acc[key]) acc[key] = { dept: p.department, members: [] };
                    acc[key].members.push(p);
                    return acc;
                  }, {})
                ).map(([key, { dept, members }]) => (
                  <div key={key}>
                    {dept && (
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dept.color }} />
                        <span className="text-[10.5px] font-medium text-slate-400 uppercase tracking-wide">{dept.name}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {members.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => onUpdate({ assignee: p.id })}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[12px] font-medium transition-colors ${
                            row.assignee === p.id ? "border-transparent text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                          style={row.assignee === p.id ? { backgroundColor: p.color } : {}}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="p-5 border-t border-slate-100">
        <button
          onClick={() => onDelete(row.id)}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border border-rose-200 text-rose-600 text-[13px] font-medium hover:bg-rose-50 transition-colors"
        >
          <Trash2 size={14} />
          Удалить {row.isSubtask ? "подзадачу" : "задачу"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Confirm delay dialog
// ============================================================

function ConfirmDelayDialog({ data, onConfirm, onCancel }) {
  if (!data) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
            <span className="text-amber-600 text-[16px] font-bold">!</span>
          </div>
          <div>
            <h3 className="text-[14.5px] font-semibold text-slate-900 leading-snug">Срок задачи сдвигается</h3>
            <p className="text-[12.5px] text-slate-500 mt-1">
              «{data.rowName}» — новая дата завершения {fmtDate(data.newEndDate)} вместо {fmtDate(data.originalEndDate)}. Это
              задержка на {data.extDays} {data.extDays === 1 ? "день" : "дня"} относительно исходного плана проекта. Изменение
              будет зафиксировано в истории задачи.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-[13px] font-medium hover:bg-slate-50 transition-colors"
          >
            Отказаться
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-lg bg-amber-500 text-white text-[13px] font-medium hover:bg-amber-600 transition-colors"
          >
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main Gantt screen
// ============================================================

export default function GanttScreen({ projectId, currentUser, onBack }) {
  const [project, setProject] = useState(null);
  const [items, setItems] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [pendingConfirm, setPendingConfirm] = useState(null);

  const loadAll = useCallback(async () => {
    const [projectData, itemsData, peopleData] = await Promise.all([
      api.getProject(projectId),
      api.getWorkItems(projectId),
      api.getPeople(),
    ]);
    setProject(projectData);
    setItems(itemsData.items.map((i) => ({ ...i, start: new Date(i.start), originalEndDate: new Date(i.originalEndDate) })));
    setPeople(peopleData.people);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    // авто-разворачиваем задачи, у которых есть подзадачи, при первой загрузке
    const init = {};
    for (const item of items) {
      if (item.kind === "task" && items.some((x) => x.kind === "subtask" && x.parentId === item.id)) {
        init[item.id] = true;
      }
    }
    setExpanded((prev) => ({ ...init, ...prev }));
  }, [items]);

  const rows = useMemo(() => flattenWork(items, expanded), [items, expanded]);

  const { rangeStart, totalDays } = useMemo(() => {
    if (items.length === 0) return { rangeStart: addDays(today, -3), totalDays: 30 };
    let minStart = null;
    let maxEnd = null;
    for (const i of items) {
      const start = new Date(i.start);
      const end = currentEndDate(i);
      if (!minStart || start < minStart) minStart = start;
      if (!maxEnd || end > maxEnd) maxEnd = end;
    }
    const start = addDays(minStart, -3);
    const end = addDays(maxEnd, 5);
    return { rangeStart: start, totalDays: Math.max(daysBetween(start, end), 14) };
  }, [items]);

  const updateRow = useCallback(
    async (rowId, patch, confirmedDelay = false) => {
      try {
        const updated = await api.updateWorkItem(rowId, patch, confirmedDelay);
        setItems((prev) =>
          prev.map((i) => (i.id === rowId ? { ...i, ...updated, start: new Date(updated.start), originalEndDate: new Date(updated.originalEndDate) } : i))
        );
        return true;
      } catch (err) {
        if (err.status === 409 && err.body?.error === "SCHEDULE_DELAY_REQUIRES_CONFIRMATION") {
          return { needsConfirm: true, body: err.body };
        }
        console.error(err);
        return false;
      }
    },
    []
  );

  // вызывается из панели деталей задачи — простая правка без диалога подтверждения
  const handleDetailUpdate = useCallback(
    (patch) => {
      if (!selectedId) return;
      updateRow(selectedId, patch);
    },
    [selectedId, updateRow]
  );

  // вызывается из GanttGrid после drag/resize — может потребовать подтверждения
  const handleDragEnd = useCallback(
    async (rowId, isSubtask, finalStart, finalDuration, originalStart, originalDuration) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;

      const result = await updateRow(rowId, { start: finalStart, duration: finalDuration }, false);

      if (result && result.needsConfirm) {
        setPendingConfirm({
          rowId,
          rowName: row.name,
          originalEndDate: new Date(result.body.originalEndDate),
          newEndDate: new Date(result.body.newEndDate),
          extDays: daysBetween(new Date(result.body.originalEndDate), new Date(result.body.newEndDate)),
          patch: { start: finalStart, duration: finalDuration },
        });
      }
    },
    [rows, updateRow]
  );

  const confirmDelay = async () => {
    if (!pendingConfirm) return;
    await updateRow(pendingConfirm.rowId, pendingConfirm.patch, true);
    setPendingConfirm(null);
  };

  const cancelDelay = () => {
    // ничего не коммитим — состояние на сервере не менялось, просто закрываем диалог
    setPendingConfirm(null);
  };

  const deleteRow = useCallback(async (rowId) => {
    await api.deleteWorkItem(rowId);
    setItems((prev) => prev.filter((i) => i.id !== rowId && i.parentId !== rowId));
    setSelectedId(null);
  }, []);

  const addTask = useCallback(async () => {
    const lastTask = items.filter((i) => i.kind === "task").slice(-1)[0];
    const start = lastTask ? addDays(new Date(lastTask.start), 2) : today;
    const created = await api.createWorkItem(projectId, {
      kind: "task",
      name: "Новая задача",
      start: isoDate(start),
      duration: 3,
      status: "todo",
      priority: "medium",
      assignee: people[0]?.id,
      deps: [],
    });
    setItems((prev) => [...prev, { ...created, start: new Date(created.start), originalEndDate: new Date(created.originalEndDate) }]);
    setSelectedId(created.id);
  }, [items, projectId, people]);

  const addSubtask = useCallback(
    async (parentId) => {
      const parent = items.find((i) => i.id === parentId);
      const created = await api.createWorkItem(projectId, {
        kind: "subtask",
        name: "Новая подзадача",
        start: isoDate(parent.start),
        duration: 2,
        status: "todo",
        priority: "low",
        assignee: people[0]?.id,
        parentId,
        deps: [],
      });
      setItems((prev) => [...prev, { ...created, start: new Date(created.start), originalEndDate: new Date(created.originalEndDate) }]);
      setExpanded((prev) => ({ ...prev, [parentId]: true }));
      setSelectedId(created.id);
    },
    [items, projectId, people]
  );

  const selectedRow = rows.find((r) => r.id === selectedId) || null;

  if (loading || !project) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center">
        <p className="text-slate-400 text-[13px]">Загрузка проекта…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex flex-col">
      <header className="bg-[#1A1D23] px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors p-1">
            <ChevronLeft size={20} />
          </button>
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
          <h1 className="text-white font-semibold text-[15px] tracking-tight">{project.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {selectedRow && !selectedRow.isSubtask && (
            <button
              onClick={() => addSubtask(selectedRow.id)}
              className="flex items-center gap-1.5 bg-white/10 text-white text-[13px] font-medium px-3.5 py-2 rounded-lg hover:bg-white/20 transition-colors"
            >
              <Plus size={15} />
              Подзадача
            </button>
          )}
          <button
            onClick={addTask}
            className="flex items-center gap-1.5 bg-[#4F5DFF] text-white text-[13px] font-medium px-3.5 py-2 rounded-lg hover:bg-[#4350DB] transition-colors"
          >
            <Plus size={15} />
            Задача
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <TaskSidebar
          rows={rows}
          people={people}
          onSelect={setSelectedId}
          selectedId={selectedId}
          onDeleteTask={deleteRow}
          expanded={expanded}
          onToggleExpand={(id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))}
        />
        <div className="flex-1 overflow-x-auto">
          <GanttGrid
            rows={rows}
            people={people}
            rangeStart={rangeStart}
            totalDays={totalDays}
            onDragEnd={handleDragEnd}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </div>

      {selectedRow && (
        <>
          <div className="fixed inset-0 bg-black/10 z-20" onClick={() => setSelectedId(null)} />
          <TaskDetailPanel row={selectedRow} people={people} onClose={() => setSelectedId(null)} onUpdate={handleDetailUpdate} onDelete={deleteRow} />
        </>
      )}

      <ConfirmDelayDialog data={pendingConfirm} onConfirm={confirmDelay} onCancel={cancelDelay} />
    </div>
  );
}
