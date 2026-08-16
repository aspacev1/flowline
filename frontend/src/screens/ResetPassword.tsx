import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { resetPassword } from "../api/auth";
import { errorKey } from "../api/errors";
import { withInvite } from "../auth/invite";
import { Field } from "../components/Field";
import { useLocale } from "../i18n/LocaleProvider";
import { MIN_PASSWORD_LENGTH } from "./Register";

/**
 * Экран, на который ведёт ссылка из письма восстановления.
 *
 * Открывается без сессии: почту читают не обязательно в том браузере, где
 * человек работал. Токен гасится только отправкой формы — сам заход на
 * страницу ничего не сжигает, поэтому почтовые сканеры, открывающие ссылки
 * до человека, ей не страшны.
 *
 * После успеха — на вход, а не сразу внутрь: сервер нарочно не открывает
 * сессию по токену из письма, и вход только что заданным паролем — секундное
 * дело.
 */
export function ResetPassword() {
  const { t } = useLocale();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  // На этот экран приходят по ссылке из письма, а её строит сервер — токена
  // приглашения в ней нет и быть не может. Параметр читается на случай, когда
  // сюда пришли внутри приложения; за письмом же приглашение переносит память
  // (см. auth/invite.ts), и её читает экран входа.
  const inviteToken = params.get("invite");

  const [password, setPassword] = useState("");
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: resetPassword });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Сервер проверит длину тоже, но человеку незачем ждать ответа ради
    // очевидного.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalErrorKey("auth.error.password_too_short");
      return;
    }
    setLocalErrorKey(null);
    mutation.mutate({ token, new_password: password });
  }

  const shownErrorKey =
    localErrorKey ?? (mutation.error ? errorKey(mutation.error) : null);

  return (
    <main className="screen screen--narrow">
      <h1>{t("auth.reset.title")}</h1>

      {token === "" && (
        <p className="error" role="alert">
          {t("auth.error.missing_token")}
        </p>
      )}

      {mutation.isSuccess && (
        <>
          <p role="status">{t("auth.reset.done")}</p>
          <p className="muted">
            <Link to={withInvite("/login", inviteToken)}>{t("auth.reset.link_login")}</Link>
          </p>
        </>
      )}

      {!mutation.isSuccess && token !== "" && (
        <form onSubmit={onSubmit} noValidate>
          <Field
            id="password"
            label={t("auth.field.new_password")}
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

          <button type="submit" disabled={mutation.isPending}>
            {t("auth.reset.submit")}
          </button>
        </form>
      )}

      {/* Мёртвая ссылка — просроченная или уже погашенная — лечится только
          новой, и дорога к ней должна быть в один шаг, а не через догадку. */}
      {(mutation.isError || token === "") && (
        <p className="muted">
          <Link to={withInvite("/forgot-password", inviteToken)}>
            {t("auth.reset.link_again")}
          </Link>
        </p>
      )}
    </main>
  );
}
