import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { Task } from "../api/projects";
import { listTaskRevisions, revisionsQueryKey } from "../api/revisions";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { baselineOf } from "../project/baseline";

/**
 * Модуль прогресса — над полями, а не строка среди них.
 *
 * Отметка прогресса — единственное, что в карточке делают каждый день, и ей
 * отдано главное место и главная кнопка: «Отметить день» прибавляет дневную
 * норму, не спрашивая цифру. Точная цифра остаётся доступной двумя путями —
 * числом (набрать) и полосой (поставить «на глаз» щелчком или перетаскиванием).
 *
 * Все три пути сводятся к одной и той же операции `set_progress`: у сервера
 * нет понятия «отметил день», есть новая готовность — и это намеренно, иначе
 * три способа ввода дали бы три вида записей об одном и том же.
 */

/** Дневная норма: сколько процентов приносит один день работы. */
function dayStep(durationDays: number): number {
  return Math.max(1, Math.round(100 / Math.max(1, durationDays)));
}

/**
 * Где готовность должна быть сегодня по плану, в процентах.
 *
 * По базовому плану, если он есть, иначе по текущим датам: до утверждения
 * плана «план» — это сами даты задачи. Доля календарная, а не по рабочим
 * дням: засечка — ориентир для взгляда, а не второй расчёт сроков, и
 * повторять здесь серверный календарь значило бы однажды с ним разойтись.
 */
function expectedToday(task: Task, today: string): number {
  const baseline = baselineOf(task);
  const start = baseline?.start ?? task.start_date;
  const end = baseline?.end ?? task.end_date;
  if (today <= start) return 0;
  if (today >= end) return 100;
  const span = Date.parse(end) - Date.parse(start);
  return Math.round(((Date.parse(today) - Date.parse(start)) / span) * 100);
}

function clamp(pct: number): number {
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function TaskProgress({
  projectId,
  task,
  canWrite,
  resetToken,
  onCommit,
}: {
  projectId: string;
  task: Task;
  canWrite: boolean;
  /** Меняется, когда сервер отказал: поле обязано вернуться к правде. */
  resetToken: unknown;
  onCommit: (pct: number) => void;
}) {
  const { t } = useLocale();
  const pct = clamp(task.progress_pct);
  const step = dayStep(task.duration_days);
  const expected = expectedToday(task, new Date().toISOString().slice(0, 10));

  // Черновик на время перетаскивания: полоса следует за курсором, а операция
  // уходит одна — при отпускании. Слать по движению значило бы писать в
  // историю десяток записей об одном жесте.
  const [dragPct, setDragPct] = useState<number | null>(null);

  // «День отмечен» живёт до закрытия карточки: гашёная кнопка защищает от
  // двойного тапа сейчас, а не ведёт учёт по календарю — учёт и так виден в
  // отметках под полосой.
  const [markedDay, setMarkedDay] = useState(false);

  // Число — то же поле, что и раньше: черновик, отправка при изменении,
  // возврат к правде по отказу сервера (см. fields.tsx про resetToken).
  const [draft, setDraft] = useState(String(pct));
  useEffect(() => setDraft(String(pct)), [pct, resetToken]);

  const barRef = useRef<HTMLDivElement | null>(null);
  const shown = dragPct ?? pct;

  const pctAt = (clientX: number): number | null => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return clamp(((clientX - rect.left) / rect.width) * 100);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canWrite) return;
    // Захват держит жест, даже если курсор ушёл с полосы: отпускание за её
    // пределами — обычное окончание перетаскивания, а не отмена.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const next = pctAt(event.clientX);
    if (next !== null) setDragPct(next);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPct === null) return;
    const next = pctAt(event.clientX);
    if (next !== null) setDragPct(next);
  };

  const onPointerUp = () => {
    if (dragPct === null) return;
    if (dragPct !== pct) onCommit(dragPct);
    setDragPct(null);
  };

  return (
    <div className="panel__progress">
      <div className="panel__progress-top">
        <span className="panel__progress-pct">
          <input
            id="panel-progress"
            name="panel-progress"
            type="number"
            min={0}
            max={100}
            value={draft}
            disabled={!canWrite}
            aria-label={t("task.panel.progress")}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              // Пустое поле — середина набора, а не значение. Границы не
              // проверяются здесь намеренно: их проверяет сервер, и отказ
              // вернёт поле к правде, объяснив словами.
              if (next !== "" && Number(next) !== pct) onCommit(Number(next));
            }}
          />
          <span aria-hidden="true">%</span>
        </span>
        <span className="panel__progress-plan">
          {t("task.panel.plan_expected", { pct: expected })}
        </span>
      </div>

      {/* Полоса — орган для мыши и пальца; для чтения и клавиатуры есть число
          выше. role="img" с подписью — как у прежней полосы: доля видна и на
          слух, а вторым слайдером с фокусом она дублировала бы поле числа. */}
      <div
        ref={barRef}
        className={canWrite ? "panel__progress-bar" : "panel__progress-bar is-static"}
        role="img"
        aria-label={t("task.panel.progress_aria", { pct: shown })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <i style={{ width: `${shown}%` }} />
        {/* Засечка плана: опережение и отставание видны без арифметики. */}
        <b
          style={{ left: `${expected}%` }}
          title={t("task.panel.plan_expected", { pct: expected })}
          aria-hidden="true"
        />
      </div>

      {canWrite && (
        <div className="panel__progress-actions">
          <button
            type="button"
            className="button--quiet panel__progress-step"
            aria-label={t("task.panel.progress_minus")}
            disabled={pct <= 0}
            onClick={() => onCommit(Math.max(0, pct - 5))}
          >
            −5
          </button>
          <button
            type="button"
            className="button--quiet panel__progress-step"
            aria-label={t("task.panel.progress_plus")}
            disabled={pct >= 100}
            onClick={() => onCommit(Math.min(100, pct + 5))}
          >
            +5
          </button>
          <button
            type="button"
            className={markedDay ? "panel__progress-day is-done" : "panel__progress-day"}
            disabled={markedDay || pct >= 100}
            onClick={() => {
              onCommit(Math.min(100, pct + step));
              setMarkedDay(true);
            }}
          >
            {markedDay
              ? t("task.panel.day_marked")
              : t("task.panel.mark_day", { pct: step })}
          </button>
        </div>
      )}

      <ProgressLog projectId={projectId} taskId={task.id} />
    </div>
  );
}

/**
 * Последние отметки прогресса — прямо под полосой.
 *
 * Не второй журнал, а его срез: те же записи, что и в ленте истории ниже, из
 * того же запроса и кэша. Здесь они отвечают на один вопрос — «жива ли
 * задача», и отвечают до того, как взгляд дойдёт до истории.
 *
 * Отказ ничего не ломает: без журнала модуль просто короче на две строки.
 */
function ProgressLog({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { t } = useLocale();

  const query = useQuery({
    queryKey: revisionsQueryKey(projectId, taskId),
    queryFn: () => listTaskRevisions(projectId, taskId),
    retry: false,
  });

  const marks = (query.data ?? [])
    .filter((entry) => entry.op.type === "set_progress")
    .slice(0, 2);

  if (marks.length === 0) return null;

  return (
    <ul className="panel__progress-log" aria-label={t("task.panel.progress_log")}>
      {marks.map((entry) => (
        <li key={entry.seq}>
          <span>
            {/* Имя человека — содержимое, а не хрома: не переводится. */}
            {entry.actor !== null && `${entry.actor.name} · `}
            {formatShortDate(t, entry.created_at.slice(0, 10))}
          </span>
          <b className="num">
            {Number(entry.op.from)} → {Number(entry.op.to)}%
          </b>
        </li>
      ))}
    </ul>
  );
}
