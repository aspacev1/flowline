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

  // Колонка и страница — соседи в одной строке, а не «шапка и всё
  // остальное»: боковая навигация обязана держать высоту экрана целиком,
  // иначе её подложка обрывается там, где кончается содержимое, и колонка
  // читается как первый блок страницы, а не как её рама.
  return (
    <div className="app">
      <Header />
      <div className="app__main">
        <Outlet />
      </div>
    </div>
  );
}
