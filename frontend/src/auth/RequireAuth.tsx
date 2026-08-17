import { Navigate, Outlet, useLocation } from "react-router-dom";

import { Header } from "../components/Header";
import { ToastProvider } from "../components/toast";
import { VerifyEmailBar } from "../components/VerifyEmailBar";
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
  const location = useLocation();

  if (status === "checking") {
    return (
      <main className="screen screen--center">
        <p role="status">{t("common.loading")}</p>
      </main>
    );
  }

  if (status === "anonymous") {
    // Адрес, на который шли, едет вместе с переходом: ссылками на проект
    // делятся, и человек, открывший присланную ссылку, обязан после входа
    // увидеть проект, а не общий список, забыв, зачем шёл.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Колонка и страница — соседи в одной строке, а не «шапка и всё
  // остальное»: боковая навигация обязана держать высоту экрана целиком,
  // иначе её подложка обрывается там, где кончается содержимое, и колонка
  // читается как первый блок страницы, а не как её рама.
  // Тосты живут на раме, а не на отдельном экране: подтверждение с «Отменить»
  // одинаково по устройству везде, где что-то меняют.
  // Полоска «адрес не подтверждён» — по той же причине над содержимым, а не
  // внутри экрана: она про учётную запись, а не про то, что человек сейчас
  // открыл, и попадаться на глаза обязана в любом разделе.
  return (
    <ToastProvider>
      <div className="app">
        <Header />
        <div className="app__main">
          <VerifyEmailBar />
          <Outlet />
        </div>
      </div>
    </ToastProvider>
  );
}
