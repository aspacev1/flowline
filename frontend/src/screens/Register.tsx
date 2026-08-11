import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ME_QUERY_KEY, register as registerRequest } from "../api/auth";
import type { User } from "../api/auth";
import { errorKey } from "../api/errors";
import { Field } from "../components/Field";
import { useLocale } from "../i18n/LocaleProvider";

/** Столько же требует сервер: `password: str = Field(min_length=8)`. */
export const MIN_PASSWORD_LENGTH = 8;

export function Register() {
  const { t, adoptProfileLocale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: registerRequest,
    onSuccess: (user: User) => {
      // Ответ регистрации — тот же профиль, что отдаёт /api/auth/me. Кладём
      // его сразу: иначе следующий экран сходит за ним второй раз и на этот
      // поход человек смотрит на индикатор загрузки без причины.
      queryClient.setQueryData(ME_QUERY_KEY, user);
      adoptProfileLocale(user.locale);
      navigate("/projects");
    },
  });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Сервер проверит длину тоже, но человеку незачем ждать ответа ради
    // очевидного.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalErrorKey("auth.error.password_too_short");
      return;
    }
    setLocalErrorKey(null);
    mutation.mutate({ name, email, password });
  }

  const shownErrorKey =
    localErrorKey ?? (mutation.error ? errorKey(mutation.error) : null);

  return (
    <main className="screen screen--narrow">
      <h1>{t("auth.register.title")}</h1>

      {/* noValidate: свою проверку мы переводим сами, а встроенные сообщения
          браузера приходят на языке браузера, а не интерфейса. */}
      <form onSubmit={onSubmit} noValidate>
        <Field
          id="name"
          label={t("auth.field.name")}
          value={name}
          onChange={setName}
          autoComplete="name"
          required
        />
        <Field
          id="email"
          label={t("auth.field.email")}
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <Field
          id="password"
          label={t("auth.field.password")}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          required
        />

        {shownErrorKey && (
          <p className="error" role="alert">
            {t(shownErrorKey)}
          </p>
        )}

        {/* Кнопка выключена на время запроса: двойной клик иначе создаёт две
            попытки регистрации на один адрес. */}
        <button type="submit" disabled={mutation.isPending}>
          {t("auth.register.submit")}
        </button>
      </form>

      <p className="muted">
        {t("auth.register.have_account")} <Link to="/login">{t("auth.register.link_login")}</Link>
      </p>
    </main>
  );
}
