import { useQuery } from "@tanstack/react-query";
import { Navigate, NavLink, Outlet } from "react-router-dom";

import { ORG_QUERY_KEY, organization } from "../api/org";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Рама раздела настроек: организация, участники, профиль.
 *
 * Три экрана собраны под одним адресом, потому что все три настраивают одно и
 * то же — рабочее пространство, а не работу в нём. Порознь они стояли в
 * колонке тремя пунктами подряд, из которых два были помечены одинаковой
 * шестерёнкой, и разница между «Организацией» и «Настройками» читалась только
 * после щелчка.
 *
 * Настройки проекта сюда не входят и входить не могут: они принадлежат
 * проекту, живут по его адресу и существуют, только пока проект открыт.
 * Вкладка «Настройки проекта» в разделе, доступном всегда, обещала бы ответ на
 * вопрос «какого проекта», которого у неё нет.
 *
 * Заголовок остаётся у каждой вкладки свой, а не заменяется общим
 * «Настройками»: вкладки — это навигация, а название страницы отвечает на
 * «куда я попал», и один заголовок на три разных экрана перестал бы отвечать.
 */
export function Settings() {
  const { t } = useLocale();

  return (
    <main className="screen">
      <nav className="tabs" aria-label={t("settings.tabs_label")}>
        {/* Настройки организации — только владельцу: остальным они открылись бы
            выключенными полями, то есть обещали бы действие, которого нет. */}
        <OwnerOnly>
          <NavLink to="/settings/organization" className={tabClass}>
            {t("nav.org_settings")}
          </NavLink>
        </OwnerOnly>
        {/* Участники видны всем: роли `client` сервер ответит отказом, но
            решать про доступ на клиенте — не дело интерфейса. */}
        <NavLink to="/settings/members" className={tabClass}>
          {t("members.title")}
        </NavLink>
        <NavLink to="/settings/profile" className={tabClass}>
          {t("settings.profile.title")}
        </NavLink>
      </nav>

      <Outlet />
    </main>
  );
}

/**
 * Куда ведёт сам `/settings`.
 *
 * Владельцу — в организацию: за настройками он и приходит. Остальным — в
 * профиль: единственная вкладка, где им есть что менять. Пока роль неизвестна,
 * не показывается ничего: редирект наугад увёл бы владельца в профиль и
 * вернулся бы обратно уже после того, как тот прочитал не свой экран.
 */
export function SettingsHome() {
  const org = useQuery({
    queryKey: ORG_QUERY_KEY,
    queryFn: organization,
    retry: false,
    staleTime: Infinity,
  });

  if (org.isPending) return null;
  return <Navigate to={org.data?.role === "owner" ? "organization" : "profile"} replace />;
}

/** Тот же запрос, что и у рамы, и из того же кэша: второго обращения не будет. */
function OwnerOnly({ children }: { children: React.ReactNode }) {
  const org = useQuery({
    queryKey: ORG_QUERY_KEY,
    queryFn: organization,
    retry: false,
    staleTime: Infinity,
  });

  return org.data?.role === "owner" ? <>{children}</> : null;
}

/**
 * Текущая вкладка помечается классом, а не цветом: подчёркивание снизу
 * показывает границы вкладки целиком, и по нему видно, куда попадёт щелчок.
 */
function tabClass({ isActive }: { isActive: boolean }) {
  return `tabs__link${isActive ? " is-current" : ""}`;
}
