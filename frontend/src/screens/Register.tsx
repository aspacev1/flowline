import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { ME_QUERY_KEY, register as registerRequest } from "../api/auth";
import type { User } from "../api/auth";
import { errorKey } from "../api/errors";
import { afterAuthPath } from "../auth/afterAuth";
import { forgetInvite, withInvite } from "../auth/invite";
import { noteVerificationSent } from "../auth/verificationNotice";
import { inviteQueryKey, previewInvitation } from "../api/invitations";
import { Field } from "../components/Field";
import { useLocale } from "../i18n/LocaleProvider";

/** Столько же требует сервер: `password: str = Field(min_length=8)`. */
export const MIN_PASSWORD_LENGTH = 8;

export function Register() {
  const { t, adoptProfileLocale } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  // Только из строки запроса, в отличие от экрана входа: приглашение здесь
  // подставляет адрес и запирает поле, а это слишком сильное действие, чтобы
  // делать его по памяти. Человек, открывший чужую ссылку и передумавший,
  // должен получить на /register пустую форму, а не заблокированный чужой
  // адрес.
  const inviteToken = params.get("invite");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localErrorKey, setLocalErrorKey] = useState<string | null>(null);

  // Приглашение спрашивается и здесь, а не только на экране приглашения:
  // адрес, на который оно выписано, подставляется в форму и не редактируется,
  // а взять его больше неоткуда.
  const invitation = useQuery({
    queryKey: inviteQueryKey(inviteToken ?? ""),
    queryFn: () => previewInvitation(inviteToken as string),
    enabled: inviteToken !== null,
    retry: false,
  });
  const boundEmail = invitation.data?.email ?? null;
  // Пока приглашение не пришло, отправлять форму нечем: адрес в ней ещё пуст,
  // и отправка ушла бы с пустым полем, которое человек не заполнял и заполнить
  // не мог. Ветка касается только прихода по ссылке — без токена запрос
  // выключен и ждать нечего.
  const waitingForInvitation = inviteToken !== null && invitation.isPending;

  const mutation = useMutation({
    mutationFn: registerRequest,
    onSuccess: (user: User) => {
      // Ответ регистрации — тот же профиль, что отдаёт /api/auth/me. Кладём
      // его сразу: иначе следующий экран сходит за ним второй раз и на этот
      // поход человек смотрит на индикатор загрузки без причины.
      queryClient.setQueryData(ME_QUERY_KEY, user);
      adoptProfileLocale(user.locale);
      // Приглашение отработало: сервер завёл членство прямо в регистрации.
      // Держать его дальше значило бы уводить человека на экран уже принятого
      // приглашения при следующем же входе.
      if (inviteToken !== null) forgetInvite();
      // Письмо с подтверждением сервер отправляет сам, следом за ответом.
      // Полоска в раме приложения прочитает эту отметку и скажет, на какой
      // адрес ушло письмо, — вместо кнопки, которая на первое же нажатие
      // ответила бы «слишком часто».
      noteVerificationSent(user.email);
      // Тот же возврат, что и на входе: человек мог прийти по ссылке на проект
      // и завести аккаунт прямо здесь.
      navigate(afterAuthPath(location.state));
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
    mutation.mutate({
      name,
      email: boundEmail ?? email,
      password,
      ...(inviteToken === null ? {} : { invite_token: inviteToken }),
    });
  }

  const shownErrorKey =
    localErrorKey ??
    (mutation.error ? errorKey(mutation.error) : null) ??
    // Мёртвая ссылка объясняется до отправки формы, а не после: заводить
    // аккаунт, чтобы узнать, что приглашение просрочено, незачем.
    (invitation.error ? errorKey(invitation.error) : null);

  return (
    <main className="screen screen--narrow">
      <h1>{t("auth.register.title")}</h1>

      {invitation.data && (
        <p className="muted">
          {t("invite.accept.summary", {
            org: invitation.data.org_name,
            role: t(`members.role.${invitation.data.role}`),
          })}
        </p>
      )}

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
          value={boundEmail ?? email}
          onChange={setEmail}
          autoComplete="email"
          required
          // Адрес приглашения не редактируется: приглашение привязано к нему,
          // и правка превратила бы отправку формы в заведомый отказ.
          readOnly={boundEmail !== null}
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
        <button type="submit" disabled={mutation.isPending || waitingForInvitation}>
          {t("auth.register.submit")}
        </button>
      </form>

      <p className="muted">
        {t("auth.register.have_account")}{" "}
        {/* Токен едет и на вход — тем же правилом, по которому экран входа
            везёт его на регистрацию. Без этого самый частый путь приглашённого
            обрывался здесь: приглашения шлют на рабочие адреса, аккаунт на них
            обычно уже есть, регистрация отвечает «адрес занят», и человек шёл
            по этой самой ссылке — в свою прежнюю организацию. */}
        <Link to={withInvite("/login", inviteToken)} state={location.state}>
          {t("auth.register.link_login")}
        </Link>
      </p>
    </main>
  );
}
