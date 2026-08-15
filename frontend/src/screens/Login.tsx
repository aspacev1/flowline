import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { errorKey } from "../api/errors";
import { afterAuthPath } from "../auth/afterAuth";
import { useAuth } from "../auth/AuthProvider";
import { Field } from "../components/Field";
import { useLocale } from "../i18n/LocaleProvider";

export function Login() {
  const { t } = useLocale();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // Человек пришёл по приглашению и завернул сюда, чтобы войти под своим
  // аккаунтом. После входа он возвращается к приглашению, а не оказывается в
  // списке проектов, забыв, зачем шёл.
  const inviteToken = params.get("invite");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [failureKey, setFailureKey] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFailureKey(null);
    try {
      await login({ email, password });
      // Приглашение впереди сохранённого адреса: оно названо в самой ссылке, по
      // которой человек сюда пришёл, а сохранённый адрес — лишь память о том,
      // куда его завернули.
      navigate(
        inviteToken === null
          ? afterAuthPath(location.state)
          : `/invite/${encodeURIComponent(inviteToken)}`,
      );
    } catch (error) {
      setFailureKey(errorKey(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="screen screen--narrow">
      <h1>{t("auth.login.title")}</h1>

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
        <Field
          id="password"
          label={t("auth.field.password")}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />

        {failureKey && (
          <p className="error" role="alert">
            {t(failureKey)}
          </p>
        )}

        <button type="submit" disabled={pending}>
          {t("auth.login.submit")}
        </button>
      </form>

      <p className="muted">
        {t("auth.login.no_account")}{" "}
        {/* Состояние едет и на регистрацию: у пришедшего по ссылке чаще всего
            ещё нет аккаунта, и терять адрес на шаг позже — та же потеря. */}
        <Link
          to={inviteToken === null ? "/register" : `/register?invite=${encodeURIComponent(inviteToken)}`}
          state={location.state}
        >
          {t("auth.login.link_register")}
        </Link>
      </p>
    </main>
  );
}
