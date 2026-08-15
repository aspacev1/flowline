import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ME_QUERY_KEY, updateProfile } from "../api/auth";
import type { User } from "../api/auth";
import { errorKey } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import { useLocale } from "../i18n/LocaleProvider";
import { TimeZoneField } from "../settings/fields";
import { browserTimeZone } from "../time/zone";

/**
 * Профиль вошедшего: имя, адрес и часовой пояс.
 *
 * Языка здесь больше нет — переключатель стоит в боковой колонке, над
 * «Настройками». Он и там пишет то же поле профиля, а вторая его копия на этом
 * экране означала бы два одинаковых переключателя в одном окне: колонка видна
 * и отсюда.
 *
 * Часовой пояс, наоборот, живёт именно тут, а не в настройках организации:
 * организация задаёт пояс планирования, общий для всей команды, а этот
 * отвечает на «какое сегодня число у меня» — и у сидящих в разных городах
 * ответ разный. Уровнем выше он был бы одним на всех и врал бы половине.
 *
 * Своего `<main>` у экрана нет: он вкладка раздела настроек, и рама его уже
 * дала.
 */
export function Profile() {
  const { t } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: (patch: { name?: string; timezone?: string | null }) => updateProfile(patch),
    onSuccess: (updated: User) => queryClient.setQueryData(ME_QUERY_KEY, updated),
  });

  const detected = browserTimeZone();

  if (!user) return null;

  return (
    <>
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

        <TimeZoneField
          id="profile-timezone"
          label={t("settings.timezone")}
          hint={t("settings.profile.timezone_hint")}
          autoLabel={
            detected
              ? t("settings.profile.timezone_auto_at", { zone: detected })
              : t("settings.profile.timezone_auto")
          }
          value={user.timezone}
          onChange={(timezone) => save.mutate({ timezone })}
        />

        <p className="field">
          <span className="settings__key">{t("auth.field.email")}</span>
          {/* Адрес не правится: на нём держится вход, и смена адреса — это
              подтверждение нового адреса, то есть отдельная работа. */}
          <span className="muted">{user.email}</span>
        </p>
      </section>
    </>
  );
}
