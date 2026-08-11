import { useQuery } from "@tanstack/react-query";

import { ORG_QUERY_KEY, organization } from "../api/org";
import { useAuth } from "../auth/AuthProvider";
import { useLocale } from "../i18n/LocaleProvider";
import { LocaleSwitch } from "./LocaleSwitch";

export function Header() {
  const { t } = useLocale();
  const { user, logout } = useAuth();

  const org = useQuery({
    queryKey: ORG_QUERY_KEY,
    queryFn: organization,
    retry: false,
    staleTime: Infinity,
  });

  return (
    <header className="header">
      {/* Название организации — содержимое пользователя: оно приходит с
          сервера как есть и не переводится ни при каком языке интерфейса.
          Пока оно не пришло, подпись держит название продукта, а не пустота,
          которая дёргала бы шапку по высоте. */}
      <span className="header__brand">{org.data?.name ?? t("app.title")}</span>

      <div className="header__side">
        {user && <span className="muted">{t("auth.greeting", { name: user.name })}</span>}
        <LocaleSwitch />
        <button type="button" className="button--quiet" onClick={() => void logout()}>
          {t("nav.logout")}
        </button>
      </div>
    </header>
  );
}
