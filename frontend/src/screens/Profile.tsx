import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ME_QUERY_KEY, updateProfile } from "../api/auth";
import type { User } from "../api/auth";
import { errorKey } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import { LocaleSwitch } from "../components/LocaleSwitch";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Уровень 4 настроек: язык интерфейса. Всё.
 *
 * Имя рядом с ним — не настройка, а свойство человека; экран один, потому что
 * второй ради одного поля был бы экраном ни о чём.
 *
 * Язык переключается тем же `LocaleSwitch`, что стоит на публичной странице, а
 * не своим собственным `select`: два разных куска кода писали одно и то же
 * поле профиля и разъезжались бы на первой же правке — один научился бы
 * применять язык сразу, другой нет. Здесь же он теперь и единственный: из
 * боковой колонки переключатель убран, потому что язык — настройка, и место
 * настройки в настройках.
 *
 * Своего `<main>` у экрана нет: он вкладка раздела настроек, и рама его уже
 * дала.
 */
export function Profile() {
  const { t } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: (patch: { name?: string }) => updateProfile(patch),
    onSuccess: (updated: User) => queryClient.setQueryData(ME_QUERY_KEY, updated),
  });

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

        {/* `div`, а не `p`, как у соседей: внутри стоит переключатель, а он
            блочный, и абзац браузер закрыл бы перед ним сам — разметка
            разъехалась бы ровно там, где её никто не правил. */}
        <div className="field">
          <span className="settings__key">{t("settings.profile.locale")}</span>
          <span className="muted">{t("settings.profile.locale_hint")}</span>
          <LocaleSwitch />
        </div>

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
