import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errorKey } from "../api/errors";
import { ORG_QUERY_KEY, checkOrgSlug, organization, updateOrganization } from "../api/org";
import type { Organization, OrganizationSettings } from "../api/org";
import { SUPPORTED_LOCALES } from "../i18n";
import { useLocale } from "../i18n/LocaleProvider";
import { DateListField, SlugField, WorkingDaysField } from "../settings/fields";

/**
 * Уровень 2 настроек: дефолты, которые наследуют все проекты организации.
 *
 * Кнопки «Сохранить» нет — как и в карточке задачи: каждое поле уходит на
 * сервер само, когда с ним закончили. Форма с кнопкой обещала бы, что до
 * нажатия ничего не произошло, и тогда пришлось бы объяснять, почему уход со
 * страницы теряет правки.
 */
export function OrgSettings() {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ORG_QUERY_KEY,
    queryFn: organization,
    retry: false,
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: (patch: Partial<OrganizationSettings & { name: string; slug: string }>) =>
      updateOrganization(patch),
    onSuccess: (org: Organization) => queryClient.setQueryData(ORG_QUERY_KEY, org),
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

  const org = query.data;
  const settings = org.settings;
  // Право решает сервер; здесь оно только выключает поля — предлагать
  // действие, которое кончится отказом, хуже, чем не предлагать вовсе.
  const readOnly = org.role !== "owner";

  return (
    <main className="screen">
      <div className="screen__head">
        <h1>{t("settings.org.title")}</h1>
      </div>

      {readOnly && <p className="muted">{t("settings.org.read_only")}</p>}

      {save.error !== null && (
        <p className="error" role="alert">
          {t(errorKey(save.error))}
        </p>
      )}

      <section className="settings">
        <p className="field">
          <label htmlFor="org-name">{t("settings.org.name")}</label>
          <input
            id="org-name"
            name="org-name"
            defaultValue={org.name}
            disabled={readOnly}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name !== "" && name !== org.name) save.mutate({ name });
            }}
          />
        </p>

        <SlugField
          id="org-slug"
          label={t("settings.org.slug")}
          value={org.slug}
          disabled={readOnly}
          check={checkOrgSlug}
          onCommit={(slug) => save.mutate({ slug })}
        />

        <p className="field">
          <label htmlFor="org-locale">{t("settings.org.locale")}</label>
          <select
            id="org-locale"
            name="org-locale"
            value={settings.default_locale}
            disabled={readOnly}
            onChange={(event) => save.mutate({ default_locale: event.target.value })}
          >
            {SUPPORTED_LOCALES.map((code) => (
              <option key={code} value={code}>
                {code.toUpperCase()}
              </option>
            ))}
          </select>
        </p>

        <p className="field">
          <label htmlFor="org-timezone">{t("settings.timezone")}</label>
          <input
            id="org-timezone"
            name="org-timezone"
            defaultValue={settings.default_timezone}
            disabled={readOnly}
            onBlur={(event) => {
              const zone = event.target.value.trim();
              if (zone !== "" && zone !== settings.default_timezone) {
                save.mutate({ default_timezone: zone });
              }
            }}
          />
        </p>

        <WorkingDaysField
          value={settings.working_days}
          disabled={readOnly}
          onChange={(working_days) => save.mutate({ working_days })}
        />

        <p className="field">
          <label htmlFor="org-threshold">{t("settings.threshold")}</label>
          <span className="muted">{t("settings.threshold_hint")}</span>
          <input
            id="org-threshold"
            name="org-threshold"
            type="number"
            min={0}
            defaultValue={settings.default_shift_threshold_days}
            disabled={readOnly}
            onBlur={(event) => {
              const days = Number(event.target.value);
              if (Number.isFinite(days) && days !== settings.default_shift_threshold_days) {
                save.mutate({ default_shift_threshold_days: days });
              }
            }}
          />
        </p>

        <DateListField
          id="org-holidays"
          label={t("settings.org.holidays")}
          hint={t("settings.org.holidays_hint")}
          value={settings.holiday_calendar}
          disabled={readOnly}
          onCommit={(holiday_calendar) => save.mutate({ holiday_calendar })}
        />

        <p className="field field--inline">
          <input
            id="org-sharing"
            name="org-sharing"
            type="checkbox"
            checked={settings.public_sharing_enabled}
            disabled={readOnly}
            onChange={(event) => save.mutate({ public_sharing_enabled: event.target.checked })}
          />
          <label htmlFor="org-sharing">{t("settings.org.public_sharing")}</label>
        </p>

        <p className="field field--inline">
          <input
            id="org-comments"
            name="org-comments"
            type="checkbox"
            checked={settings.default_comments_enabled}
            disabled={readOnly}
            onChange={(event) => save.mutate({ default_comments_enabled: event.target.checked })}
          />
          <label htmlFor="org-comments">{t("settings.org.comments")}</label>
        </p>
      </section>
    </main>
  );
}
