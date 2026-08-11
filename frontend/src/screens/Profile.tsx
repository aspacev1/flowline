import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ME_QUERY_KEY, updateProfile } from "../api/auth";
import type { User } from "../api/auth";
import { errorKey } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import { SUPPORTED_LOCALES, isSupportedLocale } from "../i18n";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Уровень 4 настроек: язык интерфейса. Всё.
 *
 * Имя рядом с ним — не настройка, а свойство человека; экран один, потому что
 * второй ради одного поля был бы экраном ни о чём.
 */
export function Profile() {
  const { t, locale, setLocale } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: (patch: { name?: string; locale?: string }) => updateProfile(patch),
    onSuccess: (updated: User) => {
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      // Язык применяется сразу, не дожидаясь перезагрузки: человек выбрал его
      // именно для того, чтобы читать этот экран на нём.
      if (isSupportedLocale(updated.locale)) setLocale(updated.locale);
    },
  });

  if (!user) return null;

  return (
    <main className="screen">
      <div className="screen__head">
        <h1>{t("settings.profile.title")}</h1>
      </div>

      {save.error !== null && (
        <p className="error" role="alert">
          {t(errorKey(save.error))}
        </p>
      )}

      <section className="settings">
        <p className="field">
          <label htmlFor="profile-name">{t("auth.field.name")}</label>
          <input
            id="profile-name"
            name="profile-name"
            defaultValue={user.name}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name !== "" && name !== user.name) save.mutate({ name });
            }}
          />
        </p>

        <p className="field">
          <label htmlFor="profile-locale">{t("settings.profile.locale")}</label>
          <span className="muted">{t("settings.profile.locale_hint")}</span>
          <select
            id="profile-locale"
            name="profile-locale"
            value={locale}
            onChange={(event) => save.mutate({ locale: event.target.value })}
          >
            {SUPPORTED_LOCALES.map((code) => (
              // Подписи кодами, а не названиями: «Azərbaycan / English /
              // Русский» пришлось бы читать на языке, которого человек,
              // возможно, и не знает, — ровно когда он ищет свой.
              <option key={code} value={code}>
                {code.toUpperCase()}
              </option>
            ))}
          </select>
        </p>

        <p className="field">
          <span className="settings__key">{t("auth.field.email")}</span>
          {/* Адрес не правится: на нём держится вход, и смена адреса — это
              подтверждение нового адреса, то есть отдельная работа. */}
          <span className="muted">{user.email}</span>
        </p>
      </section>
    </main>
  );
}
