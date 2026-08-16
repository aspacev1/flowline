import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import {
  INVITATIONS_QUERY_KEY,
  listInvitations,
  reissueInvitation,
  revokeInvitation,
} from "../api/invitations";
import type { Invitation } from "../api/invitations";
import { MEMBERS_QUERY_KEY, ORG_QUERY_KEY, members, organization } from "../api/org";
import { ConfirmAction } from "../components/ConfirmAction";
import { InviteDialog, IssuedLink } from "../components/InviteDialog";
import { useToast } from "../components/toast";
import { useLocale } from "../i18n/LocaleProvider";

function InvitationRow({
  invitation,
  mailEnabled,
}: {
  invitation: Invitation;
  mailEnabled: boolean;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [link, setLink] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: INVITATIONS_QUERY_KEY });

  const reissue = useMutation({
    mutationFn: (deliver: boolean) => reissueInvitation(invitation.id, deliver),
    onSuccess: (issued) => {
      setLink(issued.url);
      void refresh();
    },
  });

  const revoke = useMutation({
    mutationFn: () => revokeInvitation(invitation.id),
    onSuccess: () => {
      setLink(null);
      void refresh();
      // Отзыв убивает выданную ссылку — самое разрушительное, что здесь можно
      // сделать, — а на экране от него меняются два слова в подписи статуса и
      // исчезает ряд кнопок. Для необратимого действия это слишком тихо.
      showToast({ message: t("invite.revoked") });
    },
  });

  const pending = invitation.status === "pending" || invitation.status === "expired";
  const error = reissue.error ?? revoke.error;

  return (
    <li className="invite">
      <span className="invite__who">{invitation.email ?? t("invite.link_only")}</span>
      <span className="muted">{t(`members.role.${invitation.role}`)}</span>
      <span className={invitation.status === "pending" ? "muted" : "invite__dead"}>
        {t(`invite.status.${invitation.status}`)}
      </span>

      {/* Отозвать и выпустить заново можно только неиспользованное: принятое
          приглашение — это уже членство, и снимают его другим действием.

          Спрашивают все три: и «Новая ссылка», и «Отправить ещё раз» — это
          один и тот же перевыпуск, убивающий прежний токен, и вторая подпись
          скрывает это сильнее первой. Человек, нажавший «отправить ещё раз»
          в уверенности, что повторяет письмо, ломает ссылку, отправленную
          вчера. */}
      {pending && (
        <span className="invite__actions">
          <ConfirmAction
            className="button--quiet"
            label={t("invite.action.link")}
            warning={t("invite.action.reissue_warning")}
            confirm={t("invite.action.link_confirm")}
            onConfirm={() => reissue.mutate(false)}
          />
          {mailEnabled && invitation.email && (
            <ConfirmAction
              className="button--quiet"
              label={t("invite.action.resend")}
              warning={t("invite.action.reissue_warning")}
              confirm={t("invite.action.resend_confirm")}
              onConfirm={() => reissue.mutate(true)}
            />
          )}
          <ConfirmAction
            className="button--quiet"
            label={t("invite.action.revoke")}
            warning={t("invite.action.revoke_warning")}
            confirm={t("invite.action.revoke_confirm")}
            onConfirm={() => revoke.mutate()}
          />
        </span>
      )}

      {link && <IssuedLink url={link} />}
      {reissue.data?.mail_error && (
        <span className="error" role="alert">
          {t(`error.${reissue.data.mail_error}`)}
        </span>
      )}
      {error && (
        <span className="error" role="alert">
          {t(errorKey(error))}
        </span>
      )}
    </li>
  );
}

export function Members() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  const org = useQuery({ queryKey: ORG_QUERY_KEY, queryFn: organization, staleTime: Infinity });
  const roster = useQuery({ queryKey: MEMBERS_QUERY_KEY, queryFn: members });
  const isOwner = org.data?.role === "owner";

  // Приглашения видит только владелец: остальным маршрут отвечает отказом, и
  // спрашивать его ради заведомого 403 незачем.
  const invitations = useQuery({
    queryKey: INVITATIONS_QUERY_KEY,
    queryFn: listInvitations,
    enabled: isOwner,
  });

  // Своего `<main>` у экрана нет: он вкладка раздела настроек, и рама его уже
  // дала.
  return (
    <>
      <div className="screen__head">
        <h1>{t("members.title")}</h1>
        {isOwner && (
          <button type="button" onClick={() => setOpen(true)}>
            {t("invite.open")}
          </button>
        )}
      </div>

      {roster.error && (
        <p className="error" role="alert">
          {t(errorKey(roster.error))}
        </p>
      )}

      <ul className="members">
        {roster.data?.map((member) => (
          <li key={member.id}>
            <span>{member.name}</span>
            <span className="muted">{member.email}</span>
            <span className="muted">{t(`members.role.${member.role}`)}</span>
          </li>
        ))}
      </ul>

      {isOwner && (
        <section>
          <h2>{t("invite.list.title")}</h2>
          {invitations.data?.invitations.length === 0 && (
            <p className="muted">{t("invite.list.empty")}</p>
          )}
          <ul className="invites">
            {invitations.data?.invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                mailEnabled={invitations.data.mail_enabled}
              />
            ))}
          </ul>
        </section>
      )}

      {open && <InviteDialog onClose={() => setOpen(false)} />}
    </>
  );
}
