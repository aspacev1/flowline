import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import {
  INVITATIONS_QUERY_KEY,
  createInvitations,
  listInvitations,
  reissueInvitation,
  revokeInvitation,
} from "../api/invitations";
import type { Invitation, Issued } from "../api/invitations";
import { MEMBERS_QUERY_KEY, ORG_QUERY_KEY, members, organization } from "../api/org";
import { PROJECTS_QUERY_KEY, listProjects } from "../api/projects";
import { Modal } from "../components/Modal";
import { useLocale } from "../i18n/LocaleProvider";

const ROLES = ["owner", "editor", "viewer", "client"] as const;

/** Адреса вводятся списком: запятыми, точками с запятой или переводами строк. */
function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

/**
 * Ссылка, показанная один раз.
 *
 * Поле только для чтения рядом с кнопкой — не украшение: `navigator.clipboard`
 * есть не везде (старый браузер, страница по http, отказ в разрешении), и без
 * видимого текста ссылка в такой установке была бы недостижима вовсе.
 */
function IssuedLink({ url }: { url: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  return (
    <p className="issued">
      <input className="issued__url" readOnly value={url} aria-label={t("invite.issued.link")} />
      <button
        type="button"
        className="button--quiet"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(url)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        {copied ? t("invite.issued.copied") : t("invite.issued.copy")}
      </button>
    </p>
  );
}

function IssuedList({ issued }: { issued: Issued[] }) {
  const { t } = useLocale();

  return (
    <div className="issued-list">
      <p className="muted">{t("invite.issued.once")}</p>
      {issued.map((one) => (
        <div key={one.id}>
          <p>
            <strong>{one.email ?? t("invite.link_only")}</strong>{" "}
            {one.sent && <span className="ok">{t("invite.issued.sent")}</span>}
            {one.mail_error && (
              <span className="error" role="alert">
                {t(`error.${one.mail_error}`)}
              </span>
            )}
          </p>
          <IssuedLink url={one.url} />
        </div>
      ))}
    </div>
  );
}

/**
 * Приглашение — вместе с окном, в котором оно живёт.
 *
 * Окно рисует сама форма, а не экран вокруг неё: тронуты ли поля, знают только
 * они, а окну этот ответ нужен, чтобы не терять набранное от промаха мимо.
 * Снаружи такой признак пришлось бы гонять обратным вызовом — то есть держать
 * состояние формы в двух местах сразу.
 */
function InviteForm({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const [raw, setRaw] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [deliver, setDeliver] = useState(true);

  const invitations = useQuery({ queryKey: INVITATIONS_QUERY_KEY, queryFn: listInvitations });
  // Проекты нужны только роли client: остальные читают проекты организации по
  // самой роли, и выбирать им нечего.
  const projects = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: listProjects,
    enabled: role === "client",
  });

  const create = useMutation({
    mutationFn: createInvitations,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INVITATIONS_QUERY_KEY });
    },
  });

  const emails = parseEmails(raw);
  const mailEnabled = invitations.data?.mail_enabled ?? false;

  if (create.data) {
    return (
      <Modal title={t("invite.title")} onClose={onClose}>
        <IssuedList issued={create.data} />
        <div className="modal__actions">
          <button type="button" onClick={onClose}>
            {t("invite.issued.done")}
          </button>
        </div>
      </Modal>
    );
  }

  // Роль и проекты считаются наравне с адресами: список проектов клиента
  // отмечают галочками по одной, и промах мимо окна снимает их все разом.
  const dirty = raw !== "" || role !== "viewer" || projectIds.length > 0 || !deliver;

  return (
    <Modal title={t("invite.title")} onClose={onClose} dirty={dirty}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({
            emails,
            role,
            project_ids: role === "client" ? projectIds : [],
            // Без настроенной почты отправлять нечем — и спрашивать не о чем.
            deliver: mailEnabled && deliver,
          });
        }}
      >
        <p className="field">
          <label htmlFor="invite-emails">{t("invite.emails")}</label>
          <textarea
            id="invite-emails"
            rows={3}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
          />
        </p>
        {/* Приглашение без адреса — не забывчивость, а второй способ доставки, и
            назван он словами: такая ссылка достаётся предъявителю. */}
        <p className="muted">
          {emails.length === 0 ? t("invite.link_only_hint") : t("invite.emails_hint")}
        </p>

        <p className="field">
          <label htmlFor="invite-role">{t("invite.role")}</label>
          <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value)}>
            {ROLES.map((name) => (
              <option key={name} value={name}>
                {t(`members.role.${name}`)}
              </option>
            ))}
          </select>
        </p>

        {role === "client" && (
          <fieldset className="fieldset">
            <legend>{t("invite.projects")}</legend>
            <p className="muted">{t("invite.projects_hint")}</p>
            {projects.data?.map((project) => (
              <label key={project.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={projectIds.includes(project.id)}
                  onChange={(event) =>
                    setProjectIds((chosen) =>
                      event.target.checked
                        ? [...chosen, project.id]
                        : chosen.filter((id) => id !== project.id),
                    )
                  }
                />
                {project.name}
              </label>
            ))}
          </fieldset>
        )}

        {mailEnabled && emails.length > 0 && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={deliver}
              onChange={(event) => setDeliver(event.target.checked)}
            />
            {t("invite.deliver")}
          </label>
        )}

        {create.error && (
          <p className="error" role="alert">
            {t(errorKey(create.error))}
          </p>
        )}

        <div className="modal__actions">
          <button type="submit" disabled={create.isPending}>
            {t("invite.submit")}
          </button>
          <button type="button" className="button--quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InvitationRow({
  invitation,
  mailEnabled,
}: {
  invitation: Invitation;
  mailEnabled: boolean;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
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
          приглашение — это уже членство, и снимают его другим действием. */}
      {pending && (
        <span className="invite__actions">
          <button type="button" className="button--quiet" onClick={() => reissue.mutate(false)}>
            {t("invite.action.link")}
          </button>
          {mailEnabled && invitation.email && (
            <button type="button" className="button--quiet" onClick={() => reissue.mutate(true)}>
              {t("invite.action.resend")}
            </button>
          )}
          <button type="button" className="button--quiet" onClick={() => revoke.mutate()}>
            {t("invite.action.revoke")}
          </button>
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
            {t("members.invite")}
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

      {open && <InviteForm onClose={() => setOpen(false)} />}
    </>
  );
}
