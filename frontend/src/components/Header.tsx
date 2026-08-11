import { useAuth } from "../auth/AuthProvider";
import { useLocale } from "../i18n/LocaleProvider";

export function Header() {
  const { t } = useLocale();
  const { logout } = useAuth();

  return (
    <header className="header">
      <span className="header__brand">{t("app.title")}</span>
      <button type="button" className="button--quiet" onClick={() => void logout()}>
        {t("nav.logout")}
      </button>
    </header>
  );
}
