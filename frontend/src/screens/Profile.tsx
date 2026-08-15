import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ME_QUERY_KEY, updateProfile } from "../api/auth";
import type { User } from "../api/auth";
import { useAuth } from "../auth/AuthProvider";
import { TextField, useFieldSaves } from "../components/autosave";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Профиль вошедшего: имя и адрес.
 *
 * Языка здесь больше нет — переключатель стоит в боковой колонке, над
 * «Настройками». Он и там пишет то же поле профиля, а вторая его копия на этом
 * экране означала бы два одинаковых переключателя в одном окне: колонка видна
 * и отсюда.
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
  const saves = useFieldSaves(save.mutateAsync);

  if (!user) return null;

  return (
    <>
      <div className="screen__head">
        <h1>{t("settings.profile.title")}</h1>
      </div>

      <section className="settings">
        <TextField
          id="profile-name"
          label={t("auth.field.name")}
          value={user.name}
          save={saves.at("profile-name")}
          onCommit={(value) => saves.commitText("profile-name", value, (name) => ({ name }))}
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
