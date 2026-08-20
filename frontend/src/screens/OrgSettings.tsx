import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AI_CREDENTIAL_QUERY_KEY, readCredential, saveCredential } from "../api/ai";
import { errorKey } from "../api/errors";
import {
  JIRA_CREDENTIAL_QUERY_KEY,
  disconnectJira,
  readJiraCredential,
  saveJiraCredential,
} from "../api/jira";
import { ORG_QUERY_KEY, checkOrgSlug, organization, updateOrganization } from "../api/org";
import type { Organization, OrganizationSettings } from "../api/org";
import { SaveMark, SelectField, TextField, useFieldSaves } from "../components/autosave";
import { ConfirmAction } from "../components/ConfirmAction";
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
 * Зато каждое поле само и отчитывается: «сохранено» или отказ словами стоят
 * рядом с ним. Общий баннер вверху страницы для этого не годился — по нему не
 * понять, какое из десяти полей отвергнуто, а от поля до него ещё надо
 * доглядеть.
 *
 * Своего `<main>` у экрана нет: он вкладка раздела настроек, и рама его уже
 * дала. Второй `<main>` внутри первого сломал бы переход «к основному
 * содержимому» — читалка не знает, какой из двух основной.
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
    // Обещание «каждое поле уходит на сервер само» подтверждает само поле —
    // отметкой рядом с ним (см. `SaveMark`), а не тостом поверх страницы: по
    // тосту не понять, какое из десяти полей доехало, а какое отвергнуто.
    onSuccess: (org: Organization) => queryClient.setQueryData(ORG_QUERY_KEY, org),
  });
  const saves = useFieldSaves(save.mutateAsync);

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

      <section className="settings">
        <TextField
          id="org-name"
          label={t("settings.org.name")}
          value={org.name}
          disabled={readOnly}
          save={saves.at("org-name")}
          onCommit={(value) => saves.commitText("org-name", value, (name) => ({ name }))}
        />

        <SlugField
          id="org-slug"
          label={t("settings.org.slug")}
          value={org.slug}
          disabled={readOnly}
          check={checkOrgSlug}
          save={saves.at("org-slug")}
          onCommit={(slug) => saves.commit("org-slug", { slug })}
        />

        <SelectField
          id="org-locale"
          label={t("settings.org.locale")}
          value={settings.default_locale}
          disabled={readOnly}
          options={SUPPORTED_LOCALES.map((code) => ({ value: code, label: code.toUpperCase() }))}
          save={saves.at("org-locale")}
          onCommit={(default_locale) => saves.commit("org-locale", { default_locale })}
        />

        <TextField
          id="org-timezone"
          label={t("settings.timezone")}
          value={settings.default_timezone}
          disabled={readOnly}
          save={saves.at("org-timezone")}
          onCommit={(value) =>
            saves.commitText("org-timezone", value, (zone) => ({ default_timezone: zone }))
          }
        />

        <WorkingDaysField
          value={settings.working_days}
          disabled={readOnly}
          save={saves.at("org-working-days")}
          onChange={(working_days) => saves.commit("org-working-days", { working_days })}
        />

        <TextField
          id="org-threshold"
          label={t("settings.threshold")}
          hint={t("settings.threshold_hint")}
          type="number"
          min={0}
          value={String(settings.default_shift_threshold_days)}
          disabled={readOnly}
          save={saves.at("org-threshold")}
          onCommit={(value) =>
            saves.commitNumber(
              "org-threshold",
              value,
              (days) => ({ default_shift_threshold_days: days }),
              parseThresholdDays,
            )
          }
        />

        <DateListField
          id="org-holidays"
          label={t("settings.org.holidays")}
          hint={t("settings.org.holidays_hint")}
          value={settings.holiday_calendar}
          disabled={readOnly}
          save={saves.at("org-holidays")}
          onCommit={(holiday_calendar) => saves.commit("org-holidays", { holiday_calendar })}
        />

        <p className="field field--inline">
          <input
            id="org-sharing"
            name="org-sharing"
            type="checkbox"
            checked={settings.public_sharing_enabled}
            disabled={readOnly}
            onChange={(event) =>
              saves.commit("org-sharing", { public_sharing_enabled: event.target.checked })
            }
          />
          <label htmlFor="org-sharing">{t("settings.org.public_sharing")}</label>
          <SaveMark save={saves.at("org-sharing")} />
        </p>

        <LlmConnection readOnly={readOnly} />

        <JiraConnection readOnly={readOnly} />

        <p className="field field--inline">
          <input
            id="org-comments"
            name="org-comments"
            type="checkbox"
            checked={settings.default_comments_enabled}
            disabled={readOnly}
            onChange={(event) =>
              saves.commit("org-comments", { default_comments_enabled: event.target.checked })
            }
          />
          <label htmlFor="org-comments">{t("settings.org.comments")}</label>
          <SaveMark save={saves.at("org-comments")} />
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

/**
 * Подключение Jira: адрес сайта, email, API-токен.
 *
 * Та же дисциплина, что у подключения LLM: токен наружу не отдаётся никогда,
 * пустое поле при сохранении значит «оставить прежний».
 */
function JiraConnection({ readOnly }: { readOnly: boolean }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [token, setToken] = useState("");

  const credential = useQuery({
    queryKey: JIRA_CREDENTIAL_QUERY_KEY,
    queryFn: readJiraCredential,
    retry: false,
  });

  const save = useMutation({
    mutationFn: saveJiraCredential,
    onSuccess: (result) => {
      queryClient.setQueryData(JIRA_CREDENTIAL_QUERY_KEY, result);
      setToken("");
      showToast({ message: t("common.saved") });
    },
  });

  const disconnect = useMutation({
    mutationFn: disconnectJira,
    onSuccess: () => {
      queryClient.setQueryData(JIRA_CREDENTIAL_QUERY_KEY, {
        base_url: "",
        email: "",
        configured: false,
      });
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
          base_url: String(form.get("jira-base-url") ?? ""),
          email: String(form.get("jira-email") ?? ""),
          api_token: token,
        });
      }}
    >
      <h2>{t("settings.jira.title")}</h2>
      <p className="muted">{t("settings.jira.hint")}</p>

      <p className="field">
        <label htmlFor="jira-base-url">{t("settings.jira.base_url")}</label>
        <input
          id="jira-base-url"
          name="jira-base-url"
          defaultValue={current.base_url}
          disabled={readOnly}
        />
      </p>

      <p className="field">
        <label htmlFor="jira-email">{t("settings.jira.email")}</label>
        <input
          id="jira-email"
          name="jira-email"
          type="email"
          defaultValue={current.email}
          disabled={readOnly}
        />
      </p>

      <p className="field">
        <label htmlFor="jira-token">{t("settings.jira.token")}</label>
        <span className="muted">
          {current.configured ? t("settings.jira.token_set") : t("settings.jira.token_missing")}
        </span>
        <input
          id="jira-token"
          name="jira-token"
          type="password"
          autoComplete="off"
          value={token}
          disabled={readOnly}
          onChange={(event) => setToken(event.target.value)}
        />
      </p>

      {save.error !== null && (
        <p className="error" role="alert">
          {t(errorKey(save.error))}
        </p>
      )}

      <button type="submit" disabled={readOnly || save.isPending}>
        {t("settings.jira.save")}
      </button>
      {current.configured && !readOnly && (
        <ConfirmAction
          className="button--quiet"
          label={t("settings.jira.disconnect")}
          warning={t("settings.jira.disconnect_warning")}
          confirm={t("settings.jira.disconnect_confirm")}
          onConfirm={() => disconnect.mutate()}
          disabled={disconnect.isPending}
        />
      )}
    </form>
  );
}
