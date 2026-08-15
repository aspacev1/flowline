import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import { applySchedule, previewSchedule, projectQueryKey } from "../api/projects";
import type { ProjectState, ScheduleRequest } from "../api/projects";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { formatDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { useToday } from "../time/useToday";

/**
 * Окно привязки плана к дате старта — и переноса уже назначенной даты.
 *
 * До подтверждения окно показывает рассчитанные сервером границы проекта:
 * обещание «учтём выходные и праздники» без этой цифры непроверяемо, а
 * считать её здесь нельзя — календарной арифметики клиент не повторяет
 * (см. правило в optimistic.ts).
 *
 * Рабочая неделя предлагается тут же, а не только в настройках: выбор «5/2,
 * 6/1 или календарные дни» — часть решения о сроках, и назначать дату, чтобы
 * потом менять неделю отдельным походом в настройки, значило бы дать
 * заказчику один срок, а получить другой.
 */
export function StartDateDialog({
  projectId,
  state,
  onClose,
}: {
  projectId: string;
  state: ProjectState;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const rebinding = state.schedule_mode === "calendar";

  const today = useToday(state.settings?.timezone);
  const [startDate, setStartDate] = useState(state.start_date ?? today);
  // "" — оставить действующую неделю; иначе строка с маской из фиксированного
  // набора. Маска, а не список дней: тот же формат, что в настройках.
  const [week, setWeek] = useState("");
  // Судьба задач при переносе уже назначенной даты: сдвинуть всех, сохранив
  // смещения от старта, или оставить даты на месте. У первой привязки выбора
  // нет — относительные координаты обязаны стать датами.
  const [shift, setShift] = useState(true);

  const valid = startDate !== "";
  const body: ScheduleRequest = {
    start_date: startDate,
    ...(week === "" ? {} : { working_days: Number(week) }),
    ...(rebinding ? { shift_tasks: shift } : {}),
  };

  // Предпросмотр пересчитывается на каждое изменение формы: выбор даты и
  // недели дискретен, и дребезга, ради которого стоило бы откладывать запрос,
  // здесь нет.
  const preview = useQuery({
    queryKey: ["schedule-preview", projectId, body] as const,
    queryFn: () => previewSchedule(projectId, body),
    enabled: valid,
    retry: false,
  });

  const apply = useMutation({
    mutationFn: () => applySchedule(projectId, body),
    onSuccess: (next) => {
      // Ответ — готовое состояние проекта: он кладётся в кэш сразу, а не
      // ждёт перезапроса, иначе за кнопкой «Применить» на кадр оставался бы
      // относительный план.
      queryClient.setQueryData(projectQueryKey(projectId), next);
      void queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
      onClose();
    },
  });

  const weeks = [
    ["", t("schedule.week.keep")],
    ["31", t("schedule.week.mon_fri")],
    ["63", t("schedule.week.mon_sat")],
    ["127", t("schedule.week.all")],
  ] as const;

  return (
    <Modal
      title={rebinding ? t("schedule.change_title") : t("schedule.title")}
      onClose={onClose}
      dirty={startDate !== (state.start_date ?? today) || week !== ""}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply.mutate();
        }}
      >
        <Field
          id="schedule-start"
          label={t("schedule.start")}
          type="date"
          value={startDate}
          onChange={setStartDate}
        />

        <p className="field">
          <label htmlFor="schedule-week">{t("schedule.week_label")}</label>
          <select
            id="schedule-week"
            name="schedule-week"
            value={week}
            onChange={(event) => setWeek(event.target.value)}
          >
            {weeks.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </p>

        {/* Праздники не выбираются здесь: они уже настроены — у организации и
            в настройках проекта — и привязка применит их сама. Строка
            напоминает об этом, чтобы «учтём праздники» не выглядело магией. */}
        <p className="field__hint">{t("schedule.holidays_note")}</p>

        {rebinding && (
          <fieldset className="field fieldset">
            <legend>{t("schedule.tasks_legend")}</legend>
            <label className="checkbox">
              <input
                type="radio"
                name="schedule-tasks"
                checked={shift}
                onChange={() => setShift(true)}
              />
              {t("schedule.tasks_shift")}
            </label>
            <label className="checkbox">
              <input
                type="radio"
                name="schedule-tasks"
                checked={!shift}
                onChange={() => setShift(false)}
              />
              {t("schedule.tasks_keep")}
            </label>
          </fieldset>
        )}

        {/* Рассчитанные границы — до подтверждения. Ошибка предпросмотра — та
            же строка: вырожденный календарь честнее показать до кнопки. */}
        {preview.data && (
          <p className="schedule__preview" role="status">
            {preview.data.end_date
              ? t("schedule.preview", {
                  from: formatDate(t, preview.data.start_date),
                  to: formatDate(t, preview.data.end_date),
                })
              : t("schedule.preview_empty", {
                  from: formatDate(t, preview.data.start_date),
                })}
          </p>
        )}
        {preview.error && (
          <p className="error" role="alert">
            {t(errorKey(preview.error))}
          </p>
        )}

        {apply.error && (
          <p className="error" role="alert">
            {t(errorKey(apply.error))}
          </p>
        )}

        <div className="modal__actions">
          <button type="submit" disabled={!valid || preview.isError || apply.isPending}>
            {t("schedule.apply")}
          </button>
          <button type="button" className="button--quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
