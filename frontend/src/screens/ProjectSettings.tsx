import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { errorKey } from "../api/errors";
import { ORG_QUERY_KEY, organization } from "../api/org";
import { checkProjectSlug, getProject, projectQueryKey, updateProject } from "../api/projects";
import type { ProjectState } from "../api/projects";
import { useCanWrite } from "../auth/permissions";
import { useLocale } from "../i18n/LocaleProvider";
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
  const canWrite = useCanWrite();

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

      {save.error !== null && (
        <p className="error" role="alert">
          {t(errorKey(save.error))}
        </p>
      )}

      <section className="settings">
        <p className="field">
          <label htmlFor="project-name">{t("settings.project.name")}</label>
          <input
            id="project-name"
            name="project-name"
            defaultValue={state.name}
            disabled={readOnly}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name !== "" && name !== state.name) save.mutate({ name });
            }}
          />
        </p>

        <SlugField
          id="project-slug"
          label={t("settings.project.slug")}
          value={state.slug}
          disabled={readOnly}
          check={(slug) => checkProjectSlug(projectId, slug)}
          onCommit={(slug) => save.mutate({ slug })}
        />

        <p className="field">
          <label htmlFor="project-deadline">{t("settings.project.deadline")}</label>
          <input
            id="project-deadline"
            name="project-deadline"
            type="date"
            defaultValue={state.deadline ?? ""}
            disabled={readOnly}
            onChange={(event) => {
              // Пустая дата — это отсутствие дедлайна, а не пропуск поля.
              const value = event.target.value;
              save.mutate({ deadline: value === "" ? null : value });
            }}
          />
        </p>

        <Override
          id="project-timezone"
          label={t("settings.timezone")}
          inherited={orgSettings?.default_timezone ?? ""}
          overridden={overrides?.timezone ?? null}
          disabled={readOnly}
          onInherit={() => save.mutate({ timezone: null })}
          onOverride={(value) => save.mutate({ timezone: value })}
          render={(value, onCommit, disabled) => (
            <input
              id="project-timezone"
              name="project-timezone"
              defaultValue={value}
              disabled={disabled}
              onBlur={(event) => onCommit(event.target.value.trim())}
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
          onInherit={() => save.mutate({ shift_threshold_days: null })}
          onOverride={(value) => save.mutate({ shift_threshold_days: Number(value) })}
          render={(value, onCommit, disabled) => (
            <input
              id="project-threshold"
              name="project-threshold"
              type="number"
              min={0}
              defaultValue={value}
              disabled={disabled}
              onBlur={(event) => onCommit(event.target.value)}
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
          onInherit={() => save.mutate({ working_days: null })}
          onOverride={(value) => save.mutate({ working_days: Number(value) })}
          render={(value, onCommit, disabled) => (
            <WorkingDaysField
              value={Number(value) || state.calendar.working_days}
              disabled={disabled}
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
          onCommit={(holidays_extra) => save.mutate({ holidays_extra })}
        />

        <DateListField
          id="project-workdays"
          label={t("settings.project.workdays_extra")}
          hint={t("settings.project.workdays_extra_hint")}
          value={overrides?.workdays_extra ?? []}
          disabled={readOnly}
          onCommit={(workdays_extra) => save.mutate({ workdays_extra })}
        />
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
  onInherit: () => void;
  onOverride: (value: string) => void;
  render: (
    value: string,
    onCommit: (value: string) => void,
    disabled: boolean,
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
      {!inherits && render(overridden, onOverride, Boolean(disabled))}
    </div>
  );
}
