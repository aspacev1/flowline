import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import { errorKey } from "../api/errors";
import { listPlanApprovals } from "../api/projects";
import type { ProjectState } from "../api/projects";
import { feedQueryKey, listProjectRevisions } from "../api/revisions";
import type { RevisionEntry } from "../api/revisions";
import { Modal } from "../components/Modal";
import { relativeDayLabel } from "../gantt/relative";
import { formatDate, formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { useApprovePlan } from "./PlanApproval";
import { planChanges, removedTasks } from "./planChanges";
import type { PlanChange } from "./planChanges";

import "./planChanges.css";

/**
 * Операции, которые двигают сроки, — и только они.
 *
 * Тот же набор, что стоит за группой «Сроки» в фильтре истории: причины сдвигов
 * ищутся среди них, потому что причину спрашивают именно за уход от базового
 * плана, а переименование или смена статуса её не требуют и не имеют.
 */
const DATE_OPS = ["move_task", "set_duration", "resize_task", "move_category"];

/**
 * Окно «что изменилось после согласования».
 *
 * Окном, а не боковой панелью: список отвечает на один вопрос целиком, его
 * читают и закрывают, а не держат открытым рядом с лентой. Панель отняла бы у
 * диаграммы треть ширины ради текста, который перестаёт быть нужным через
 * десять секунд.
 *
 * Считается всё из состояния проекта — оно уже на экране. Два запроса, которые
 * окно всё же делает, лениво и только за тем, чего в состоянии нет по
 * определению: снимок версии знает удалённые задачи, журнал — причины сдвигов.
 * Обоих может не быть (отказ, роль без права на журнал) — тогда окно показывает
 * то же, что и без них, и молчит: список расхождений от этого не портится.
 */
export function PlanChangesDialog({
  projectId,
  state,
  canReapprove,
  onOpenTask,
  onClose,
}: {
  projectId: string;
  state: ProjectState;
  /** Право переутвердить план — владелец при живой связи. */
  canReapprove: boolean;
  /** Открыть карточку задачи. Окно при этом закрывается: карточка встаёт на его место. */
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [group, setGroup] = useState<GroupKey | "all">("all");

  // Летопись версий — ради имён удалённых задач и имени согласовавшего. Ключ
  // тот же, что у ленты истории: она уже могла её загрузить, и второй раз
  // ходить незачем.
  const approvals = useQuery({
    queryKey: ["project", projectId, "plan-approvals"] as const,
    queryFn: () => listPlanApprovals(projectId),
    retry: false,
  });

  // Причины сдвигов. Одной страницей: причина нужна к последнему уходу задачи
  // от плана, а не ко всем подряд, и она стоит в верхних записях журнала.
  const feedFilters = { types: DATE_OPS };
  const feed = useQuery({
    queryKey: feedQueryKey(projectId, feedFilters),
    queryFn: () => listProjectRevisions(projectId, feedFilters),
    retry: false,
  });

  // Окно закрывается само: список, ради которого его открыли, только что стал
  // пустым, и оставлять его на экране значило бы показывать вчерашнее.
  const approve = useApprovePlan(projectId, onClose);

  const changes = planChanges(state);
  const removed = removedTasks(state, approvals.data ?? []);
  const reasons = reasonsByTask(state, feed.data ?? []);

  const approvedBy = (approvals.data ?? []).find(
    (approval) => approval.version === state.plan_version,
  )?.approved_by;

  /** Дата в том виде, в каком её показывает лента: у плана без старта — день проекта. */
  const day = (iso: string) =>
    state.schedule_mode === "relative"
      ? relativeDayLabel(t, iso)
      : formatShortDate(t, iso);

  const groups: { key: GroupKey; rows: PlanChange[] }[] = [
    { key: "shifts", rows: changes.shifts },
    { key: "durations", rows: changes.durations },
    { key: "added", rows: changes.added },
    { key: "removed", rows: removed },
  ];
  const shown = groups.filter(
    (row) => row.rows.length > 0 && (group === "all" || group === row.key),
  );

  /**
   * Показывать ли причину у этой строки.
   *
   * Задача, которую и подвинули, и растянули, стоит в двух группах, а причина у
   * неё одна — и напечатанная дважды подряд читается сбоем, а не объяснением.
   * Поэтому в общем списке её несёт первая строка задачи; под фильтром по
   * группе соседней строки на экране нет, и молчать было бы не о чем.
   */
  const showsReason = (change: PlanChange): boolean => {
    if (change.kind === "removed" || !reasons.has(change.task.id)) return false;
    if (group !== "all" || change.kind !== "duration") return true;
    return !changes.shifts.some((shift) => shift.task.id === change.task.id);
  };

  return (
    <Modal title={t("plan.changes_title", { version: state.plan_version })} onClose={onClose}>
      {/* Когда согласовали и кто — то, относительно чего считается весь список.
          Без этой строки «после v1» остаётся отсылкой к неизвестной дате. */}
      {state.plan_approved_at && (
        <p className="plan-changes__since">
          {t("plan.changes_since", { date: formatDate(t, state.plan_approved_at.slice(0, 10)) })}
          {/* Имя человека — содержимое пользователя: без перевода. */}
          {approvedBy && <span className="muted"> · {approvedBy.name}</span>}
        </p>
      )}

      {/* Сводка отвечает на «что вообще случилось» до того, как список прочитан,
          и она же фильтр: у групп разная срочность, и «покажи только сдвиги» —
          первое, что просят, увидев число. Пустые группы не показываются: тег с
          нулём предлагает открыть пустоту. */}
      <div className="plan-changes__summary">
        <GroupTag active={group === "all"} onClick={() => setGroup("all")}>
          {t("plan.changes_all")}
        </GroupTag>
        {groups
          .filter((row) => row.rows.length > 0)
          .map((row) => (
            <GroupTag
              key={row.key}
              active={group === row.key}
              onClick={() => setGroup(group === row.key ? "all" : row.key)}
            >
              {t(`plan.changes_group.${row.key}`)} · {row.rows.length}
            </GroupTag>
          ))}
      </div>

      <div className="plan-changes__groups">
        {shown.map(({ key, rows }) => (
          <section key={key} className="plan-changes__group">
            <h3 className="plan-changes__group-title">{t(`plan.changes_group.${key}`)}</h3>
            <ul className="plan-changes__list">
              {rows.map((change) => (
                <li key={rowKey(change)} className="plan-changes__row">
                  <div className="plan-changes__main">
                    {/* Имя задачи ведёт в её карточку: увидев расхождение, идут
                        чинить именно эту задачу, и путь туда не должен идти
                        через закрытие окна и поиск строки глазами. У удалённой
                        задачи вести некуда — она остаётся текстом. */}
                    {change.kind === "removed" ? (
                      <span className="plan-changes__name plan-changes__name--gone">
                        {change.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="plan-changes__name"
                        onClick={() => {
                          onClose();
                          onOpenTask(change.task.id);
                        }}
                      >
                        {change.task.name}
                      </button>
                    )}
                    <span className="plan-changes__diff">{diffOf(change, t, day)}</span>
                    <Badge change={change} />
                  </div>
                  {/* Причина — то, ради чего её и спрашивали при сдвиге: без неё
                      список отвечает «что изменилось», а с ней — «почему». */}
                  {showsReason(change) && change.kind !== "removed" && (
                    <p className="plan-changes__reason">{reasons.get(change.task.id)}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {approve.error !== null && (
        <p className="error" role="alert">
          {t(errorKey(approve.error))}
        </p>
      )}

      {/* Переутверждение прямо отсюда — и без повторного вопроса: окно уже
          показало поимённо всё, что станет новой базой, и спрашивать «вы
          уверены» поверх прочитанного списка значит спрашивать о том, на что
          человек только что смотрел. Кнопка в шапке вопрос по-прежнему задаёт:
          там перед глазами ничего нет. */}
      {canReapprove && (
        <div className="plan-changes__foot">
          <span className="plan-changes__hint">{t("plan.changes_reapprove_hint")}</span>
          <button
            type="button"
            className="button--quiet button--alert"
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
          >
            {t("plan.changes_reapprove", { version: state.plan_version + 1 })}
          </button>
        </div>
      )}
    </Modal>
  );
}

type GroupKey = "shifts" | "durations" | "added" | "removed";

/**
 * Бейдж расхождения — та же величина и тот же цвет, что у бейджа на полоске
 * ленты: «+2 дн.» красным, «−2 дн.» зелёным. Приближение — не тревога, и
 * набирать его цветом тревоги значило бы сообщать о хорошей новости плохим
 * голосом.
 *
 * У работы сверх плана числа нет вовсе: сравнивать не с чем, и вместо цифры
 * стоит слово. У удалённой — бейджа нет: её расхождение уже названо в строке.
 */
function Badge({ change }: { change: PlanChange }) {
  const { t } = useLocale();

  if (change.kind === "removed") return null;
  if (change.kind === "added") {
    return <span className="plan-changes__badge is-new">{t("plan.changes_beyond")}</span>;
  }

  const days = t("common.days_short", { count: Math.abs(change.days) });
  return (
    <span className={`plan-changes__badge ${change.days > 0 ? "is-late" : "is-early"}`}>
      {t(change.days > 0 ? "gantt.deviation_late" : "gantt.deviation_early", { days })}
    </span>
  );
}

function GroupTag({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="plan-changes__tag"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Ключ строки: одна задача попадает и в сдвиги, и в длительность. */
function rowKey(change: PlanChange): string {
  return change.kind === "removed" ? `removed-${change.taskId}` : `${change.kind}-${change.task.id}`;
}

/** Было и стало — то, ради чего строка существует. */
function diffOf(
  change: PlanChange,
  t: (key: string, params?: Record<string, string | number>) => string,
  day: (iso: string) => string,
): string {
  switch (change.kind) {
    case "shift":
      return `${day(change.from)} → ${day(change.to)}`;
    case "duration":
      return `${t("common.days_short", { count: change.from })} → ${t("common.days_short", {
        count: change.to,
      })}`;
    case "added":
      return t("plan.changes_added_at", { date: day(change.task.start_date) });
    case "removed":
      return t("plan.changes_removed_note");
  }
}

/**
 * Последняя объяснённая причина по каждой задаче — из журнала.
 *
 * Берётся только то, что случилось после согласования: причина, названная до
 * него, объясняет сдвиг, который сам же и вошёл в базовый план.
 *
 * Записи приходят новыми вперёд, поэтому первая найденная причина и есть
 * последняя по времени — дальше по задаче не заглядываем. Сдвиг категории
 * объясняет все её задачи разом: причина у движения одна, а уехали от него
 * многие, и повторить её у каждой строки честнее, чем не показать ни у одной.
 */
function reasonsByTask(state: ProjectState, entries: RevisionEntry[]): Map<string, string> {
  const reasons = new Map<string, string>();
  const approvedAt = state.plan_approved_at;
  if (!approvedAt) return reasons;

  for (const entry of entries) {
    if (!entry.reason || entry.created_at < approvedAt) continue;

    const taskId = entry.op.task_id;
    if (typeof taskId === "string") {
      if (!reasons.has(taskId)) reasons.set(taskId, entry.reason);
      continue;
    }

    const categoryId = entry.op.category_id;
    if (typeof categoryId === "string") {
      for (const task of state.tasks) {
        if (task.category_id === categoryId && !reasons.has(task.id)) {
          reasons.set(task.id, entry.reason);
        }
      }
    }
  }

  return reasons;
}
