import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ME_QUERY_KEY, updateProfile } from "../api/auth";
import type { User } from "../api/auth";
import { useAuth } from "../auth/AuthProvider";
import { SUPPORTED_LOCALES } from "../i18n";
import type { Locale } from "../i18n";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Подписи кодами языков, а не названиями: «Azərbaycan / English / Русский»
 * пришлось бы читать на языке, которого человек, возможно, и не знает —
 * ровно в тот момент, когда он ищет свой.
 *
 * Выбор вошедшего уходит в профиль, а не только в память браузера: язык живёт
 * в профиле, и человек, выбравший русский на работе, обязан увидеть русский и
 * дома. Отказ сервера при этом ничего не откатывает — язык уже переключился, и
 * возвращать его обратно из-за неудачной записи значило бы наказать человека
 * за чужую сетевую ошибку; следующий выбор запишется.
 */
export function LocaleSwitch() {
  const { locale, setLocale, t } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const remember = useMutation({
    mutationFn: (next: Locale) => updateProfile({ locale: next }),
    onSuccess: (updated: User) => queryClient.setQueryData(ME_QUERY_KEY, updated),
  });

  const choose = (next: Locale) => {
    setLocale(next);
    if (user) remember.mutate(next);
  };

  return (
    <div className="locale-switch" role="group" aria-label={t("locale.switch_label")}>
      {SUPPORTED_LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          className="button--quiet"
          // aria-pressed, а не подсветка цветом: включённый язык должен быть
          // слышен, а не только виден.
          aria-pressed={code === locale}
          onClick={() => choose(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
