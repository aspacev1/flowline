import { Navigate, Outlet } from "react-router-dom";

import { Header } from "../components/Header";
import { useLocale } from "../i18n/LocaleProvider";
import { useAuth } from "./AuthProvider";

/**
 * Обёртка защищённых маршрутов. Пока сессия проверяется, показывает
 * индикатор и не решает: решение о доступе принимается только после ответа
 * сервера.
 */
export function RequireAuth() {
  const { status } = useAuth();
  const { t } = useLocale();

  if (status === "checking") {
    return (
      <main className="screen screen--center">
        <p role="status">{t("common.loading")}</p>
      </main>
    );
  }

  if (status === "anonymous") {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <Header />
      <Outlet />
    </>
  );
}
