import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { errorKey } from "../api/errors";
import { acceptInvitation, inviteQueryKey, previewInvitation } from "../api/invitations";
import { useAuth } from "../auth/AuthProvider";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Экран приглашения: то, что видит человек, открывший ссылку.
 *
 * Живёт снаружи RequireAuth: приглашённый по определению ещё не в
 * организации, а часто и не в системе вовсе. Требовать входа прежде, чем он
 * узнает, куда его зовут, — это просить подписать не глядя.
 */
export function Invite() {
  const { t } = useLocale();
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, status, logout } = useAuth();

  const preview = useQuery({
    queryKey: inviteQueryKey(token),
    queryFn: () => previewInvitation(token),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: () => {
      // Сервер переключил сессию на новую организацию — всё, что кэш помнит о
      // прежней, устарело в тот же момент. Инвалидация, а не clear(): профиль
      // вошедшего никуда не делся, и выбрасывать его значило бы отправить
      // приложение в «проверяю сессию» сразу после успешного действия.
      void queryClient.invalidateQueries();
      navigate("/projects");
    },
  });

  if (preview.isPending || status === "checking") {
    return (
      <main className="screen screen--narrow screen--center">
        <p role="status">{t("common.loading")}</p>
      </main>
    );
  }

  if (preview.error) {
    // Просрочено, отозвано, принято — три разных сообщения, а не одно
    // «ссылка недействительна»: по каждому человек делает разное.
    return (
      <main className="screen screen--narrow">
        <h1>{t("invite.accept.title")}</h1>
        <p className="error" role="alert">
          {t(errorKey(preview.error))}
        </p>
        <p className="muted">
          <Link to="/projects">{t("invite.accept.go_home")}</Link>
        </p>
      </main>
    );
  }

  const invitation = preview.data;
  // Адрес привязывает приглашение: вошедшему под другим аккаунтом система
  // прямо говорит, кому оно адресовано, и предлагает выйти — вместо отказа,
  // из которого не понять, что делать дальше.
  const wrongAccount =
    user !== null && invitation.email !== null && invitation.email !== user.email.toLowerCase();

  return (
    <main className="screen screen--narrow">
      <h1>{t("invite.accept.title")}</h1>

      <p>
        {t("invite.accept.summary", {
          org: invitation.org_name,
          role: t(`members.role.${invitation.role}`),
        })}
      </p>
      {invitation.inviter_name && (
        <p className="muted">{t("invite.accept.inviter", { name: invitation.inviter_name })}</p>
      )}
      {invitation.email === null && <p className="muted">{t("invite.accept.bearer")}</p>}

      {status === "anonymous" && (
        <p className="invite__choice">
          <Link to={`/register?invite=${encodeURIComponent(token)}`}>
            {t("invite.accept.register")}
          </Link>
          <Link to={`/login?invite=${encodeURIComponent(token)}`}>{t("invite.accept.login")}</Link>
        </p>
      )}

      {wrongAccount && (
        <>
          <p className="error" role="alert">
            {t("invite.accept.wrong_account", { email: invitation.email as string })}
          </p>
          <button type="button" onClick={() => void logout()}>
            {t("invite.accept.logout")}
          </button>
        </>
      )}

      {status === "authenticated" && !wrongAccount && (
        <>
          {accept.error && (
            <p className="error" role="alert">
              {t(errorKey(accept.error))}
            </p>
          )}
          <button type="button" disabled={accept.isPending} onClick={() => accept.mutate()}>
            {t("invite.accept.submit")}
          </button>
        </>
      )}
    </main>
  );
}
