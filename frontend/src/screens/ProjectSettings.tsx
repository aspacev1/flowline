import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ConfirmAction } from "../components/ConfirmAction";
import { useToast } from "../components/toast";
import { useLocale } from "../i18n/LocaleProvider";
import { SharePanel } from "../project/SharePanel";
import {
  DateListField,
  SlugField,
  WorkingDaysField,
  parseThresholdDays,
} from "../settings/fields";

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
  const showToast = useToast();
  const canWrite = useCanWrite();
  // Удаление проекта — право владельца, как и пересогласование плана:
  // редактор правит настройки, но не расстаётся с проектом целиком. Решает
  // всё равно сервер — здесь лишь не предлагается действие, которое кончится
  // отказом.
  const isOwner = useOrgRole() === "owner";

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
    onSuccess: (state: ProjectState) => {
      queryClient.setQueryData(projectQueryKey(projectId), state);
      // Кнопки «Сохранить» здесь нет, поле уходит на сервер по уходу фокуса —
      // и без тоста единственный признак записи это то, что значение не
      // отскочило обратно. Отсутствие отката — плохое подтверждение: оно
      // выглядит ровно так же, как ничего не отправленный запрос.
      showToast({ message: t("common.saved") });
    },
  });

  // Имя передаётся в мутацию, а не читается из `state` в обработчике: к моменту
  // успеха проекта уже нет ни на сервере, ни в кэше — а назвать в тосте нужно
  // именно то, что удалили.
  const remove = useMutation({
    mutationFn: (_name: string) => deleteProject(projectId),
    onSuccess: (_result, name: string) => {
      // Кэш проекта не инвалидируется, а выбрасывается: перезапрос по этому
      // ключу теперь может ответить только 404-й.
      queryClient.removeQueries({ queryKey: projectQueryKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
      // replace, а не push: «назад» к настройкам удалённого проекта вело бы
      // на экран, которому нечего показать, кроме ошибки.
      navigate("/projects", { replace: true });
      // Список проектов сам по себе не отчитывается: он выглядит одинаково и
      // после удаления, и после нажатия «К проектам». Отмены тост не
      // предлагает намеренно — вместе с проектом ушёл журнал ревизий, и
      // возвращать состояние неоткуда; об этом честно сказано и в подтверждении.
      showToast({ message: t("settings.project.deleted", { name }) });
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
          onOverride={(value) => {
            // Пустое поле — не «порог ноль»: пока числа нет, переопределение
            // остаётся прежним, а не превращается в «объяснять каждый сдвиг».
            const days = parseThresholdDays(value);
            if (days !== null) save.mutate({ shift_threshold_days: days });
          }}
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
            <ConfirmAction
              className="button--quiet button--alert"
              label={t("settings.project.delete")}
              warning={t("settings.project.delete_warning")}
              confirm={t("settings.project.delete_confirm")}
              onConfirm={() => remove.mutate(state.name)}
              disabled={remove.isPending}
            />
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
