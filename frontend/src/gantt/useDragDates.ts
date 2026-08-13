import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";

import { ApiError } from "../api/client";
import { errorKey } from "../api/errors";
import { projectQueryKey, undoLast } from "../api/projects";
import type { Task } from "../api/projects";
import { useToast } from "../components/toast";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { patchTask } from "../project/optimistic";
import { useAskShiftReason } from "../project/ShiftReason";
import { useProjectMutation } from "../project/useProjectMutation";
import { addDays } from "./timescale";
import type { Scale } from "./timescale";

/**
 * Перетаскивание полоски по горизонтали.
 *
 * Указательные события, а не мышиные: захват указателя удерживает жест, даже
 * когда курсор ушёл за край ленты, — а он уходит постоянно, потому что тащат до
 * конца видимой области и дальше. Мышиные события в этот момент достаются
 * элементу под курсором, и полоска замирает на полпути. Заодно то же самое
 * работает пальцем на планшете.
 *
 * Смещение переводится в дни через шкалу, а не делением на ширину дня: шкала
 * знает, где кончается день, и знает это в одном месте.
 */
export function useDragDates({
  projectId,
  task,
  scale,
  enabled,
}: {
  projectId: string;
  task: Task;
  scale: Scale;
  /** Гость полоски не двигает. */
  enabled: boolean;
}) {
  const { apply } = useProjectMutation(projectId);
  const { t } = useLocale();
  const showToast = useToast();
  const askReason = useAskShiftReason();
  const queryClient = useQueryClient();

  const from = useRef<{ pointerId: number; x: number } | null>(null);
  // Было ли движение. Живёт в ref, а не в состоянии: значение читается в
  // обработчике клика сразу после отпускания, и перерисовка тут не нужна.
  const dragged = useRef(false);
  const [offset, setOffset] = useState(0);

  /**
   * День, на который попадёт начало полоски, сдвинутой на `dx` пикселей.
   *
   * Половина дня прибавляется, чтобы день менялся посередине ячейки, а не на
   * её краю: иначе полоска перескакивает на новый день от дрожания руки в
   * один пиксель.
   */
  const dateAfter = (dx: number) =>
    scale.dateAt(scale.xOf(task.start_date) + dx + scale.dayWidth / 2);

  /**
   * Отмена из тоста. Отменяется последняя операция проекта — на момент показа
   * тоста это и есть перенос; сам путь тот же, что у кнопки «Отменить»:
   * отмена подчиняется тому же порогу объяснений, что и любой сдвиг.
   */
  const undoMove = async () => {
    try {
      try {
        await undoLast(projectId);
      } catch (refusal) {
        if (!(refusal instanceof ApiError) || refusal.code !== "reason_required" || !askReason) {
          throw refusal;
        }
        // Числа — из подсказок сервера: вкладка не знает, к каким датам
        // приведёт обратная операция.
        const reason = await askReason({
          taskName: task.name,
          deviationDays: refusal.hints.deviationDays ?? 0,
          thresholdDays: refusal.hints.thresholdDays ?? 0,
        });
        if (reason === null) return;
        await undoLast(projectId, reason);
      }
      await queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
    } catch (error) {
      // Отказ отмены показывается там же, где было предложение отменить:
      // человек смотрит на тост, а не на шапку проекта.
      showToast({ message: t(errorKey(error)) });
    }
  };

  const move = (startDate: string) => {
    // Ноль дней — ничего не отправляем: жест, вернувший полоску на место, не
    // изменение и не должен оставлять запись в истории.
    if (startDate === task.start_date) return;
    apply(
      { type: "move_task", task_id: task.id, start_date: startDate },
      (state) => patchTask(state, task.id, { start_date: startDate }),
    ).then(
      () => {
        // Тост с отменой — после подтверждения сервером, как в макете:
        // перенос применяется сразу, а лёгкий путь назад лежит под рукой.
        showToast({
          message: t("gantt.moved", { date: formatShortDate(t, startDate) }),
          actionLabel: t("undo.action"),
          onAction: () => void undoMove(),
        });
      },
      () => {
        // Откат уже сделан внутри `apply`, и полоска на глазах вернулась туда,
        // откуда её тащили. Это и есть сообщение об отказе: другого места для
        // него на ленте нет, а модальное окно поверх диаграммы прерывало бы
        // работу там, где человек и так всё увидел.
      },
    );
  };

  return {
    /** Сдвиг полоски в пикселях, пока её тащат. */
    offset,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!enabled || event.button !== 0) return;
        from.current = { pointerId: event.pointerId, x: event.clientX };
        dragged.current = false;
        // jsdom этого метода не знает, да и браузер откажет на устаревшем
        // указателе. Захват — улучшение жеста, а не его условие.
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },

      onPointerMove(event: PointerEvent<HTMLElement>) {
        const start = from.current;
        if (start === null || start.pointerId !== event.pointerId) return;
        const dx = event.clientX - start.x;
        // Порог в пару пикселей: дрожание руки при щелчке не должно
        // превращать щелчок в перетаскивание и закрывать карточку, которую
        // человек как раз открывал.
        if (Math.abs(dx) > 2) dragged.current = true;
        setOffset(dx);
      },

      onPointerUp(event: PointerEvent<HTMLElement>) {
        const start = from.current;
        if (start === null || start.pointerId !== event.pointerId) return;
        from.current = null;
        setOffset(0);
        move(dateAfter(event.clientX - start.x));
      },

      onPointerCancel() {
        from.current = null;
        setOffset(0);
      },

      onClickCapture(event: MouseEvent<HTMLElement>) {
        // После отпускания кнопки браузер шлёт клик по той же полоске. Без
        // этого перехвата каждое перетаскивание заканчивалось бы открытием
        // карточки — и человек, подвинувший десять задач, закрывал бы десять
        // карточек.
        if (!dragged.current) return;
        dragged.current = false;
        event.preventDefault();
        event.stopPropagation();
      },

      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        // Полоска объявлена кнопкой, и человек, работающий с клавиатуры,
        // обязан иметь способ сдвинуть задачу. Shift — чтобы стрелки остались
        // за прокруткой ленты: без него нельзя было бы просто посмотреть, что
        // справа, не сдвинув при этом сроки.
        if (!enabled || !event.shiftKey) return;
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        move(addDays(task.start_date, step));
      },
    },
  };
}
