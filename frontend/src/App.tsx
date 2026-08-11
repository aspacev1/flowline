import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import "./styles.css";
import { AppRoutes } from "./AppRoutes";
import { AuthProvider } from "./auth/AuthProvider";
import { LocaleProvider } from "./i18n/LocaleProvider";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Язык снаружи аутентификации: экран входа тоже говорит на языке
          читателя, хотя профиля ещё нет. */}
      <LocaleProvider>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
