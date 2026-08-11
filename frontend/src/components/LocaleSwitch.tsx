import { SUPPORTED_LOCALES } from "../i18n";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Подписи кодами языков, а не названиями: «Azərbaycan / English / Русский»
 * пришлось бы читать на языке, которого человек, возможно, и не знает —
 * ровно в тот момент, когда он ищет свой.
 */
export function LocaleSwitch() {
  const { locale, setLocale, t } = useLocale();

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
          onClick={() => setLocale(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
