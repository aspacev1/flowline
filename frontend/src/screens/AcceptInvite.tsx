import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { errorKey } from "../api/errors";
import { acceptInvitation, previewInvitation } from "../api/invitations";
import { ORG_QUERY_KEY } from "../api/org";
import { PROJECTS_QUERY_KEY } from "../api/projects";
import { useAuth } from "../auth/AuthProvider";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Экран приёма приглашения.
 *
 * Открывается и без сессии: человек с ссылкой на руках должен увидеть, куда
 * его зовут, прежде чем заводить аккаунт. Членство при этом появляется только
 * после явного нажатия — никакой автоматической подстановки в чужую
 * организацию по совпадению адреса.
 */
export function AcceptInvite() {
  const { t } = useLocale();
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, status } = useAuth();

  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => previewInvitation(token),
    retry: false,
  });

  const join = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: async () => {
      // Организация и список проектов у этого человека теперь другие: кэш
      // сбрасывается целиком, а не дописывается по месту.
      await queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
      navigate("/projects");
    },
  });

  if (preview.isPending || status === "checking") {
    return (
      <main className="screen">
        <p role="status">{t("common.loading")}</p>
      </main>
    );
  }

  if (preview.error) {
    // Просроченное, отозванное и уже принятое — три разных сообщения, а не
    // одно «ссылка недействительна»: человек должен понимать, просить ли
    // новую ссылку или он уже в системе и достаточно войти.
    return (
      <main className="screen">
        <p className="error" role="alert">
          {t(errorKey(preview.error))}
        </p>
        <p>
          <Link to="/login">{t("auth.login.submit")}</Link>
        </p>
      </main>
    );
  }

  const invitation = preview.data;
  const wrongAccount =
    user !== null && invitation.email !== null && invitation.email !== user.email;

  return (
    <main className="screen">
      <div className="screen__head">
        {/* Название организации — содержимое: не переводится. */}
        <h1>{t("invite.title", { org: invitation.org_name })}</h1>
      </div>

      <p>{t("invite.role", { role: t(`members.role.${invitation.role}`) })}</p>

      {invitation.email === null && <p className="muted">{t("invite.bearer")}</p>}

      {user === null && (
        <>
          <p>{t("invite.sign_in_first")}</p>
          <p>
            {/* Приглашение остаётся в силе и сработает, когда человек
                вернётся по этой же ссылке: обычная регистрация ничего не
                ломает. */}
            <Link to="/login">{t("auth.login.submit")}</Link>{" "}
            <Link to="/register">{t("auth.register.submit")}</Link>
          </p>
        </>
      )}

      {wrongAccount && (
        <p className="error" role="alert">
          {t("invite.another_account", { email: invitation.email ?? "" })}
        </p>
      )}

      {user !== null && !wrongAccount && (
        <button type="button" onClick={() => join.mutate()} disabled={join.isPending}>
          {t("invite.accept")}
        </button>
      )}

      {join.error !== null && (
        <p className="error" role="alert">
          {t(errorKey(join.error))}
        </p>
      )}
    </main>
  );
}
