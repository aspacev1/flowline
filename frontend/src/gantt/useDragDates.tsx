import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { UndoMove } from "./UndoMove";
import { addDays } from "./timescale";
import type { BarMotion } from "./useBarMotion";
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
 *
 * Саму полоску жест не двигает — он только называет сдвиг, а двигает
 * `useBarMotion`, записывая его прямо в узел. Раньше сдвиг лежал в состоянии
 * React, и каждое движение указателя перерисовывало строку целиком; на сотне
 * задач это десятки перерисовок в секунду ради одного числа, которое дальше
 * стиля никуда не идёт.
 *
 * Начатый жест прерывается по Esc: передумать посреди перетаскивания — обычное
 * дело, и единственным выходом иначе было бы дотащить полоску обратно на глаз,
 * то есть попасть точно в тот же день, откуда её взяли.
 */
export function useDragDates({
  projectId,
  task,
  scale,
  enabled,
  motion,
}: {
  projectId: string;
  task: Task;
  scale: Scale;
  /** Гость полоски не двигает. */
  enabled: boolean;
  motion: BarMotion;
}) {
  const { apply } = useProjectMutation(projectId);
  const { t } = useLocale();
  const showToast = useToast();
  const askReason = useAskShiftReason();
  const queryClient = useQueryClient();

  const from = useRef<{ pointerId: number; x: number; bar: HTMLElement } | null>(null);
  // Было ли движение. Живёт в ref, а не в состоянии: значение читается в
  // обработчике клика сразу после отпускания, и перерисовка тут не нужна.
  const dragged = useRef(false);
  // Два состояния, потому что вопроса два, и отвечают на них в разное время.
  //
  // `started` — палец на полоске: с этого мгновения жест можно передумать, и
  // слушатель Esc заводится здесь. Ref для него не годится — слушатель ставится
  // в эффекте, и ref его не разбудит.
  //
  // `dragging` — полоску действительно тащат: она поднимается над соседями и
  // меняет курсор. Это уже после порога в пару пикселей, иначе вид полоски
  // мигал бы на каждом открытии карточки.
  //
  // Сам сдвиг в состояние не попадает ни в каком виде: его пишет слой движения
  // прямо в узел.
  const [started, setStarted] = useState(false);
  const [dragging, setDragging] = useState(false);

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
   * Отмена из тоста. Отменяется именно тот перенос, о котором тост говорит:
   * его номер назвал сервер, применяя операцию, и он же уходит обратно в
   * `expected_seq`. «Последнее изменение проекта» здесь не годится — за шесть
   * секунд, что висит тост, последним успевает стать чужое.
   *
   * Сам путь тот же, что у кнопки «Отменить» в ленте истории: отмена
   * подчиняется тому же порогу объяснений, что и любой сдвиг.
   */
  const undoMove = async (seq: number) => {
    try {
      try {
        await undoLast(projectId, { seq });
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
        await undoLast(projectId, { seq, reason });
      }
      await queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
    } catch (error) {
      // Отказ отмены показывается там же, где было предложение отменить:
      // человек смотрит на тост, а не на шапку проекта.
      showToast({ message: t(errorKey(error)), tone: "error" });
    }
  };

  /**
   * Прервать начатый жест, ничего не отправив.
   *
   * Полоска возвращается туда, откуда её потащили: пока жест идёт, дат он не
   * менял — их меняет только отпускание. Возврат мгновенный, а не переездом:
   * Esc отменяет жест, а не доводит его до конца, и ехать полоске неоткуда —
   * её место по датам всё это время не менялось, менялся только сдвиг.
   */
  const cancel = useCallback(() => {
    const start = from.current;
    from.current = null;
    motion.hold(0);
    motion.release();
    setStarted(false);
    setDragging(false);
    // Захват снимается руками: иначе полоска до конца жеста продолжает
    // получать события указателя, и отпускание прилетело бы уже прерванному
    // перетаскиванию.
    if (start && start.bar.hasPointerCapture?.(start.pointerId)) {
      start.bar.releasePointerCapture?.(start.pointerId);
    }
    // Клик, который браузер пришлёт вслед за отпусканием, гасится тем же
    // признаком, что и после обычного перетаскивания: Esc означает «ничего не
    // делать», а не «открыть карточку».
    dragged.current = true;
    // Кроме слоя движения, живых зависимостей нет: внутри только ref-ы да
    // функции состояния, а сам слой ссылку не меняет. Постоянная ссылка нужна
    // эффекту ниже — иначе он переподписывался бы на каждой отрисовке.
  }, [motion]);

  // Esc прерывает начатое перетаскивание — как везде, где жест можно начать и
  // передумать. Слушатель на окне, а не на полоске: захват указателя держит
  // события мыши, но не клавиатуры, и фокус во время жеста может оказаться где
  // угодно — на полоске, если браузер отдал его нажатию, и на теле документа,
  // если не отдал.
  useEffect(() => {
    if (!started) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, started]);

  /**
   * @param hold Держать ли полоску там, куда её бросили, пока перенос идёт.
   *   Так делает перетаскивание: полоску отпустили под пальцем, и до решения
   *   ей место там. Клавиатура не держит ничего — там полоска и не двигалась,
   *   а поехавшая до ответа на вопрос о причине означала бы сдвиг, которого
   *   ещё не было.
   *
   *   Держит сам слой движения: сдвиг уже записан в узел, и «подождать» здесь
   *   значит не снимать его до ответа. Второе состояние с той же датой считало
   *   бы этот сдвиг ещё раз — и полоска на кадр уезжала бы вдвое.
   */
  const move = (startDate: string, hold = false) => {
    // Ноль дней — ничего не отправляем: жест, вернувший полоску на место, не
    // изменение и не должен оставлять запись в истории.
    if (startDate === task.start_date) {
      if (hold) motion.settle();
      return;
    }
    apply(
      { type: "move_task", task_id: task.id, start_date: startDate },
      (state) => patchTask(state, task.id, { start_date: startDate }),
    )
      .then(
        (revision) => {
          // Тост с отменой — после подтверждения сервером, как в макете:
          // перенос применяется сразу, а лёгкий путь назад лежит под рукой.
          // Номер ревизии — из ответа сервера: он и делает кнопку обещанием
          // вернуть этот перенос, а не «что там сейчас сверху журнала».
          showToast({
            message: t("gantt.moved", { date: formatShortDate(t, startDate) }),
            action: (
              <UndoMove
                projectId={projectId}
                seq={revision.seq}
                onUndo={() => void undoMove(revision.seq)}
              />
            ),
          });
        },
        () => {
          // Откат уже сделан внутри `apply`, а полоска возвращается туда,
          // откуда её тащили, когда отпускается захват ниже. Это и есть
          // сообщение об отказе: другого места для него на ленте нет, а
          // модальное окно поверх диаграммы прерывало бы работу там, где
          // человек и так всё увидел. Отказ при этом всегда приходит после
          // решения человека, а не до него, — и движение назад читается как
          // ответ на его жест, а не как отказ ещё не заданного вопроса.
        },
      )
      .finally(() => {
        // Перенос решён — сдвиг можно снимать. Подтверждённый снял уже слой
        // разметки: новый `left` пришёл с датами, и `settle` увидит ноль.
        // Отказанный снимается здесь, и полоска едет назад — после ответа, а
        // не до него.
        if (hold) motion.settle();
      });
  };

  return {
    /** Идёт ли жест прямо сейчас. */
    dragging,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!enabled || event.button !== 0) return;
        from.current = { pointerId: event.pointerId, x: event.clientX, bar: event.currentTarget };
        dragged.current = false;
        // Жест начат — с этого мгновения его можно передумать по Esc. Вид
        // полоски при этом не меняется: щелчок начинается точно так же, и
        // подъём над соседями мигал бы на каждом открытии карточки.
        setStarted(true);
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
        if (Math.abs(dx) > 2 && !dragged.current) {
          dragged.current = true;
          setDragging(true);
        }
        motion.hold(dx);
      },

      onPointerUp(event: PointerEvent<HTMLElement>) {
        const start = from.current;
        if (start === null || start.pointerId !== event.pointerId) return;
        from.current = null;
        setStarted(false);
        setDragging(false);
        // Полоска ждёт ровно там, где её отпустили, — сдвиг снимет `settle`,
        // когда перенос решится, и она доедет до своего дня уже с ответом.
        // Снятый прямо сейчас, он вернул бы её на место ещё до вопроса о
        // причине — то есть ответил бы «не получилось» раньше, чем спросили.
        motion.release(true);
        move(dateAfter(event.clientX - start.x), true);
      },

      onPointerCancel() {
        cancel();
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
        //
        // Сочетание названо вслух в двух местах — в `aria-keyshortcuts`
        // полоски и в строке подсказки карточки наведения (Row, BarTip):
        // возможность, о которой знает только исходник, всё равно что её нет.
        if (!enabled || !event.shiftKey) return;
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        move(addDays(task.start_date, step));
      },
    },
  };
}
