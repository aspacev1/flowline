import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { errorKey } from "../api/errors";
import { ORG_QUERY_KEY, organization } from "../api/org";
import {
  PROJECTS_QUERY_KEY,
  checkProjectSlug,
  deleteProject,
  getProject,
  projectQueryKey,
  updateProject,
} from "../api/projects";
import type { ProjectState } from "../api/projects";
import { useCanWrite, useOrgRole } from "../auth/permissions";
import { SaveMark, TextField, ValueField, useFieldSaves } from "../components/autosave";
import type { FieldSave } from "../components/autosave";
import { useLocale } from "../i18n/LocaleProvider";
import { SharePanel } from "../project/SharePanel";
import { DateListField, SlugField, WorkingDaysField } from "../settings/fields";

/**
 * Уровень 3 настроек: слаг, целевая дата и переопределения организации.
 *
 * Переопределение показывается переключателем «наследовать / своё», а не
 * подставленным значением организации: подставленное число выглядит как
 * собственное значение проекта, и человек, поправивший его «обратно как было»,
 * незаметно превращает наследование в копию — ровно то, чего спецификация
 * велит избегать.
 */
export function ProjectSettings() {
  const { t } = useLocale();
  const { projectId = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  // Удаление проекта — право владельца, как и пересогласование плана:
  // редактор правит настройки, но не расстаётся с проектом целиком. Решает
  // всё равно сервер — здесь лишь не предлагается действие, которое кончится
  // отказом.
  const isOwner = useOrgRole() === "owner";
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const query = useQuery({
    queryKey: projectQueryKey(projectId),
    queryFn: () => getProject(projectId),
    retry: false,
  });
  const org = useQuery({
    queryKey: ORG_QUERY_KEY,
    queryFn: organization,
    retry: false,
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateProject>[1]) => updateProject(projectId, patch),
    onSuccess: (state: ProjectState) =>
      queryClient.setQueryData(projectQueryKey(projectId), state),
  });
  const saves = useFieldSaves(save.mutateAsync);

  const remove = useMutation({
    mutationFn: () => deleteProject(projectId),
    onSuccess: () => {
      // Кэш проекта не инвалидируется, а выбрасывается: перезапрос по этому
      // ключу теперь может ответить только 404-й.
      queryClient.removeQueries({ queryKey: projectQueryKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
      // replace, а не push: «назад» к настройкам удалённого проекта вело бы
      // на экран, которому нечего показать, кроме ошибки.
      navigate("/projects", { replace: true });
    },
  });

  if (query.isPending) {
    return (
      <main className="screen">
        <p role="status">{t("common.loading")}</p>
      </main>
    );
  }

  if (query.error) {
    return (
      <main className="screen">
        <p className="error" role="alert">
          {t(errorKey(query.error))}
        </p>
      </main>
    );
  }

  const state = query.data;
  const overrides = state.overrides;
  const orgSettings = org.data?.settings;
  const readOnly = !canWrite;

  return (
    <main className="screen">
      <div className="screen__head">
        {/* Название проекта — содержимое пользователя: не переводится. */}
        <h1>{t("settings.project.title", { name: state.name })}</h1>
        <Link to={`/projects/${projectId}`}>{t("settings.project.back")}</Link>
      </div>

      <section className="settings">
        <TextField
          id="project-name"
          label={t("settings.project.name")}
          value={state.name}
          disabled={readOnly}
          save={saves.at("project-name")}
          onCommit={(value) => saves.commitText("project-name", value, (name) => ({ name }))}
        />

        <SlugField
          id="project-slug"
          label={t("settings.project.slug")}
          value={state.slug}
          disabled={readOnly}
          check={(slug) => checkProjectSlug(projectId, slug)}
          save={saves.at("project-slug")}
          onCommit={(slug) => saves.commit("project-slug", { slug })}
        />

        <ValueField
          id="project-deadline"
          label={t("settings.project.deadline")}
          type="date"
          value={state.deadline ?? ""}
          disabled={readOnly}
          // Пустая дата — это отсутствие дедлайна, а не пропуск поля.
          allowEmpty
          save={saves.at("project-deadline")}
          onCommit={(value) =>
            saves.commit("project-deadline", { deadline: value === "" ? null : value })
          }
        />

        <Override
          id="project-timezone"
          label={t("settings.timezone")}
          inherited={orgSettings?.default_timezone ?? ""}
          overridden={overrides?.timezone ?? null}
          disabled={readOnly}
          save={saves.at("project-timezone")}
          onInherit={() => saves.commit("project-timezone", { timezone: null })}
          onOverride={(value) =>
            saves.commitText("project-timezone", value, (zone) => ({ timezone: zone }))
          }
          render={(value, onCommit, disabled, save) => (
            <TextField
              id="project-timezone"
              labelledBy="project-timezone-label"
              value={value}
              disabled={disabled}
              save={save}
              onCommit={onCommit}
            />
          )}
        />

        <Override
          id="project-threshold"
          label={t("settings.threshold")}
          inherited={String(orgSettings?.default_shift_threshold_days ?? "")}
          overridden={
            overrides?.shift_threshold_days === null || overrides === undefined
              ? null
              : String(overrides.shift_threshold_days)
          }
          disabled={readOnly}
          save={saves.at("project-threshold")}
          onInherit={() => saves.commit("project-threshold", { shift_threshold_days: null })}
          onOverride={(value) =>
            saves.commitNumber("project-threshold", value, (days) => ({
              shift_threshold_days: days,
            }))
          }
          render={(value, onCommit, disabled, save) => (
            <TextField
              id="project-threshold"
              labelledBy="project-threshold-label"
              type="number"
              min={0}
              value={value}
              disabled={disabled}
              save={save}
              onCommit={onCommit}
            />
          )}
        />

        <Override
          id="project-working-days"
          label={t("settings.working_days")}
          inherited={String(orgSettings?.working_days ?? "")}
          overridden={
            overrides?.working_days === null || overrides === undefined
              ? null
              : String(overrides.working_days)
          }
          disabled={readOnly}
          save={saves.at("project-working-days")}
          onInherit={() => saves.commit("project-working-days", { working_days: null })}
          onOverride={(value) =>
            saves.commit("project-working-days", { working_days: Number(value) })
          }
          render={(value, onCommit, disabled, save) => (
            <WorkingDaysField
              value={Number(value) || state.calendar.working_days}
              disabled={disabled}
              save={save}
              onChange={(mask) => onCommit(String(mask))}
            />
          )}
        />

        <DateListField
          id="project-holidays"
          label={t("settings.project.holidays_extra")}
          hint={t("settings.project.holidays_extra_hint")}
          value={overrides?.holidays_extra ?? []}
          disabled={readOnly}
          save={saves.at("project-holidays")}
          onCommit={(holidays_extra) => saves.commit("project-holidays", { holidays_extra })}
        />

        <DateListField
          id="project-workdays"
          label={t("settings.project.workdays_extra")}
          hint={t("settings.project.workdays_extra_hint")}
          value={overrides?.workdays_extra ?? []}
          disabled={readOnly}
          save={saves.at("project-workdays")}
          onCommit={(workdays_extra) => saves.commit("project-workdays", { workdays_extra })}
        />

        {/* Публичная ссылка — последним блоком: это не настройка расчёта, а
            решение показать проект наружу. */}
        {!readOnly && <SharePanel projectId={projectId} />}

        {/* Удаление — после всего остального: это не настройка, а расставание
            с проектом. Подтверждение разворачивается на месте, как у
            пересогласования плана, — и предупреждает честно: вместе с
            проектом уходит журнал ревизий, то есть и возможность отмены. */}
        {isOwner && (
          <div className="settings__danger">
            {remove.error !== null && (
              <p className="error" role="alert">
                {t(errorKey(remove.error))}
              </p>
            )}
            {confirmingDelete ? (
              <span className="plan__confirm">
                <span className="muted">{t("settings.project.delete_warning")}</span>
                <button
                  type="button"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                >
                  {t("settings.project.delete_confirm")}
                </button>
                <button
                  type="button"
                  className="button--quiet"
                  onClick={() => setConfirmingDelete(false)}
                >
                  {t("common.cancel")}
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="button--quiet button--alert"
                onClick={() => setConfirmingDelete(true)}
              >
                {t("settings.project.delete")}
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

/**
 * Значение, которое либо наследуется, либо задано этим проектом.
 *
 * Переключатель стоит прежде самого поля намеренно: сперва решается, чьё это
 * значение, и только потом — какое. Обратный порядок предлагал бы править
 * число, которое проекту не принадлежит.
 */
function Override({
  id,
  label,
  inherited,
  overridden,
  disabled,
  save,
  onInherit,
  onOverride,
  render,
}: {
  id: string;
  label: string;
  /** Значение организации — то, что действует, пока переопределения нет. */
  inherited: string;
  /** `null` — наследуется. */
  overridden: string | null;
  disabled?: boolean;
  save?: FieldSave;
  onInherit: () => void;
  onOverride: (value: string) => void;
  render: (
    value: string,
    onCommit: (value: string) => void,
    disabled: boolean,
    save?: FieldSave,
  ) => React.ReactNode;
}) {
  const { t } = useLocale();
  const inherits = overridden === null;

  return (
    <div className="settings__override">
      <span className="settings__override-label" id={`${id}-label`}>
        {label}
      </span>
      <label className="settings__inherit">
        <input
          type="checkbox"
          checked={inherits}
          disabled={disabled}
          onChange={(event) => (event.target.checked ? onInherit() : onOverride(inherited))}
        />
        {t("settings.inherit", { value: inherited })}
      </label>
      {/* Отметка об отправке — там, где стоит орган управления: пока значение
          наследуется, это сама галочка, а дальше её показывает поле. Иначе о
          возврате к наследованию не сказал бы никто. */}
      {inherits ? <SaveMark save={save} /> : render(overridden, onOverride, Boolean(disabled), save)}
    </div>
  );
}
