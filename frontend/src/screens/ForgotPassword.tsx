import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { requestPasswordReset } from "../api/auth";
import { errorKey } from "../api/errors";
import { withInvite } from "../auth/invite";
import { Field } from "../components/Field";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Просьба о письме для восстановления пароля.
 *
 * После отправки экран говорит «если адрес зарегистрирован — письмо ушло», а
 * не «письмо ушло»: сервер нарочно отвечает одинаково на любой адрес, и
 * обещать больше, чем он знает, значило бы врать половине читателей.
 */
export function ForgotPassword() {
  const { t } = useLocale();
  const [params] = useSearchParams();
  // Приглашение проезжает и через восстановление: сюда попадают посреди пути
  // «пришёл по ссылке — аккаунт уже есть — пароля не помню», и возврат на вход
  // должен вести обратно к приглашению, а не в прежнюю организацию.
  const inviteToken = params.get("invite");
  const [email, setEmail] = useState("");
  const mutation = useMutation({ mutationFn: requestPasswordReset });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    mutation.mutate(email);
  }

  return (
    <main className="screen screen--narrow">
      <h1>{t("auth.forgot.title")}</h1>

      {mutation.isSuccess ? (
        <p role="status">{t("auth.forgot.sent")}</p>
      ) : (
        <>
          <p className="muted">{t("auth.forgot.intro")}</p>

          <form onSubmit={onSubmit} noValidate>
            <Field
              id="email"
              label={t("auth.field.email")}
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              required
            />

            {mutation.isError && (
              <p className="error" role="alert">
                {t(errorKey(mutation.error))}
              </p>
            )}

            <button type="submit" disabled={mutation.isPending}>
              {t("auth.forgot.submit")}
            </button>
          </form>
        </>
      )}

      <p className="muted">
        <Link to={withInvite("/login", inviteToken)}>{t("auth.forgot.link_login")}</Link>
      </p>
    </main>
  );
}
