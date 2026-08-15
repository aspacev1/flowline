import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AI_CREDENTIAL_QUERY_KEY, readCredential, saveCredential } from "../api/ai";
import { errorKey } from "../api/errors";
import { ORG_QUERY_KEY, checkOrgSlug, organization, updateOrganization } from "../api/org";
import type { Organization, OrganizationSettings } from "../api/org";
import { useToast } from "../components/toast";
import { SUPPORTED_LOCALES } from "../i18n";
import { useLocale } from "../i18n/LocaleProvider";
import {
  DateListField,
  SlugField,
  WorkingDaysField,
  parseThresholdDays,
} from "../settings/fields";

/**
 * Уровень 2 настроек: дефолты, которые наследуют все проекты организации.
 *
 * Кнопки «Сохранить» нет — как и в карточке задачи: каждое поле уходит на
 * сервер само, когда с ним закончили. Форма с кнопкой обещала бы, что до
 * нажатия ничего не произошло, и тогда пришлось бы объяснять, почему уход со
 * страницы теряет правки.
 *
 * Своего `<main>` у экрана нет: он вкладка раздела настроек, и рама его уже
 * дала. Второй `<main>` внутри первого сломал бы переход «к основному
 * содержимому» — читалка не знает, какой из двух основной.
 */
export function OrgSettings() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const showToast = useToast();

  const query = useQuery({
    queryKey: ORG_QUERY_KEY,
    queryFn: organization,
    retry: false,
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: (patch: Partial<OrganizationSettings & { name: string; slug: string }>) =>
      updateOrganization(patch),
    onSuccess: (org: Organization) => {
      queryClient.setQueryData(ORG_QUERY_KEY, org);
      // Обещание «каждое поле уходит на сервер само» надо подтверждать, иначе
      // это только обещание: человек, поправивший часовой пояс и ушедший со
      // страницы, не имеет ни одного признака, что правка доехала.
      showToast({ message: t("common.saved") });
    },
  });

  if (query.isPending) return <p role="status">{t("common.loading")}</p>;

  if (query.error) {
    return (
      <p className="error" role="alert">
        {t(errorKey(query.error))}
      </p>
    );
  }

  const org = query.data;
  const settings = org.settings;
  // Право решает сервер; здесь оно только выключает поля — предлагать
  // действие, которое кончится отказом, хуже, чем не предлагать вовсе.
  const readOnly = org.role !== "owner";

  return (
    <>
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
              const days = parseThresholdDays(event.target.value);
              if (days !== null && days !== settings.default_shift_threshold_days) {
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

        <LlmConnection readOnly={readOnly} />

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
    </>
  );
}

/**
 * Подключение LLM: провайдер, адрес, модель, ключ.
 *
 * Ключ наружу не отдаётся никогда — только признак «настроен». Поэтому пустое
 * поле ключа означает «оставить прежний»: требовать его при правке адреса
 * значило бы требовать невозможного, потому что взять его человеку неоткуда.
 */
function LlmConnection({ readOnly }: { readOnly: boolean }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [key, setKey] = useState("");

  const credential = useQuery({
    queryKey: AI_CREDENTIAL_QUERY_KEY,
    queryFn: readCredential,
    retry: false,
  });

  const save = useMutation({
    mutationFn: saveCredential,
    onSuccess: (result) => {
      queryClient.setQueryData(AI_CREDENTIAL_QUERY_KEY, result);
      setKey("");
      // Поле ключа очищается при успехе — и без тоста это очищение читается
      // как «ввод не приняли», ровно наоборот смыслу.
      showToast({ message: t("common.saved") });
    },
  });

  // Отказ 403 здесь — не поломка: не владелец этот блок просто не видит.
  if (credential.error || !credential.data) return null;
  const current = credential.data;

  return (
    <form
      className="settings__fieldset"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget as HTMLFormElement);
        save.mutate({
          provider: String(form.get("llm-provider") ?? "openai"),
          base_url: String(form.get("llm-base-url") ?? ""),
          model: String(form.get("llm-model") ?? ""),
          api_key: key,
        });
      }}
    >
      <h2>{t("settings.llm.title")}</h2>
      <p className="muted">{t("settings.llm.hint")}</p>

      <p className="field">
        <label htmlFor="llm-provider">{t("settings.llm.provider")}</label>
        <input
          id="llm-provider"
          name="llm-provider"
          defaultValue={current.provider || "openai"}
          disabled={readOnly}
        />
      </p>

      <p className="field">
        <label htmlFor="llm-base-url">{t("settings.llm.base_url")}</label>
        <input
          id="llm-base-url"
          name="llm-base-url"
          defaultValue={current.base_url}
          disabled={readOnly}
        />
      </p>

      <p className="field">
        <label htmlFor="llm-model">{t("settings.llm.model")}</label>
        <input id="llm-model" name="llm-model" defaultValue={current.model} disabled={readOnly} />
      </p>

      <p className="field">
        <label htmlFor="llm-key">{t("settings.llm.key")}</label>
        <span className="muted">
          {current.configured ? t("settings.llm.key_set") : t("settings.llm.key_missing")}
        </span>
        <input
          id="llm-key"
          name="llm-key"
          type="password"
          autoComplete="off"
          value={key}
          disabled={readOnly}
          onChange={(event) => setKey(event.target.value)}
        />
      </p>

      {save.error !== null && (
        <p className="error" role="alert">
          {t(errorKey(save.error))}
        </p>
      )}

      <button type="submit" disabled={readOnly || save.isPending}>
        {t("settings.llm.save")}
      </button>
    </form>
  );
}
