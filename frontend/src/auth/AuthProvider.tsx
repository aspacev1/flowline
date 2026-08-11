import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";

import {
  ME_QUERY_KEY,
  login as loginRequest,
  logout as logoutRequest,
  me,
} from "../api/auth";
import type { LoginInput, User } from "../api/auth";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Состояний три, а не два. Без `checking` маршрут вынужден решать про доступ
 * раньше, чем узнал ответ сервера, — и человек при каждой перезагрузке видит
 * вспышку экрана входа, хотя он давно вошёл.
 */
export type AuthStatus = "checking" | "authenticated" | "anonymous";

type AuthContextValue = {
  user: User | null;
  status: AuthStatus;
  login: (input: LoginInput) => Promise<User>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { adoptProfileLocale } = useLocale();

  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: me,
    // Повтор здесь означал бы «подержим человека на индикаторе ещё пару
    // секунд, чтобы получить тот же 401».
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  // Кука HTTP-only: клиент не может посмотреть, есть ли сессия, — он может
  // только спросить сервер. Пока ответа нет, состояние честно неизвестно.
  const user = (query.data as User | null | undefined) ?? null;
  const status: AuthStatus = query.isPending
    ? "checking"
    : user
      ? "authenticated"
      : "anonymous";

  useEffect(() => {
    if (user) adoptProfileLocale(user.locale);
  }, [user, adoptProfileLocale]);

  const loginMutation = useMutation({
    mutationFn: loginRequest,
    onSuccess: (loggedIn: User) => {
      queryClient.setQueryData(ME_QUERY_KEY, loggedIn);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logoutRequest,
    onSuccess: () => {
      // Сначала выбрасывается весь кэш: в нём лежат проекты ушедшего
      // человека, и следующий вошедший на этой же вкладке не должен увидеть
      // их даже на кадр. Профиль ставится после очистки — иначе очистка
      // снесла бы и его, и приложение снова ушло бы в «проверяю».
      queryClient.clear();
      queryClient.setQueryData(ME_QUERY_KEY, null);
    },
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      login: (input) => loginMutation.mutateAsync(input),
      logout: () => logoutMutation.mutateAsync().then(() => undefined),
    }),
    [user, status, loginMutation, logoutMutation],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth вызван вне AuthProvider");
  }
  return value;
}
