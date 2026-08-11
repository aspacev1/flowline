import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import {
  CONFIG_QUERY_KEY,
  INVITATIONS_QUERY_KEY,
  createInvitations,
  installConfig,
  listInvitations,
  reissueInvitation,
  revokeInvitation,
} from "../api/invitations";
import type { IssuedInvitation } from "../api/invitations";
import { MEMBERS_QUERY_KEY, ORG_QUERY_KEY, members as fetchMembers, organization } from "../api/org";
import { PROJECTS_QUERY_KEY, listProjects } from "../api/projects";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Участники организации и приглашения.
 *
 * Ссылка на приглашение показывается один раз — в момент выпуска, — потому что
 * сервер её не помнит: в базе лежит хеш. Поэтому выпущенные за этот заход
 * ссылки держатся на экране, пока с него не ушли, а не прячутся после первого
 * же обновления списка.
 */
export function Members() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<IssuedInvitation[]>([]);

  const org = useQuery({ queryKey: ORG_QUERY_KEY, queryFn: organization, retry: false });
  const config = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: installConfig,
    retry: false,
    staleTime: Infinity,
  });
  const people = useQuery({ queryKey: MEMBERS_QUERY_KEY, queryFn: fetchMembers, retry: false });
  const invitations = useQuery({
    queryKey: INVITATIONS_QUERY_KEY,
    queryFn: listInvitations,
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: INVITATIONS_QUERY_KEY });

  const invite = useMutation({
    mutationFn: createInvitations,
    onSuccess: async (result) => {
      setIssued((current) => [...result, ...current]);
      await refresh();
    },
  });

  const reissue = useMutation({
    mutationFn: (id: string) => reissueInvitation(id, config.data?.mail_enabled ?? false),
    onSuccess: async (result) => {
      setIssued((current) => [result, ...current]);
      await refresh();
    },
  });

  const revoke = useMutation({
    mutationFn: revokeInvitation,
    onSuccess: refresh,
  });

  if (org.data && org.data.role !== "owner") {
    return (
      <main className="screen">
        <p className="error" role="alert">
          {t("error.forbidden")}
        </p>
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="screen__head">
        <h1>{t("members.title")}</h1>
      </div>

      <InviteForm
        mailEnabled={config.data?.mail_enabled ?? false}
        pending={invite.isPending}
        error={invite.error}
        onSubmit={(payload) => invite.mutate(payload)}
      />

      {issued.length > 0 && (
        <section className="settings">
          <h2>{t("members.issued")}</h2>
          {/* Ссылку негде взять потом: сервер её не помнит. Об этом сказано
              прямо, а не оставлено на догадку. */}
          <p className="muted">{t("members.issued_hint")}</p>
          <ul className="members__list">
            {issued.map((item) => (
              <li key={`${item.id}-${item.link}`} className="members__row">
                <span>{item.email ?? t("members.by_link")}</span>
                <code className="members__link">{item.link}</code>
                <button
                  type="button"
                  className="button--quiet"
                  onClick={() => void navigator.clipboard?.writeText(item.link ?? "")}
                >
                  {t("members.copy")}
                </button>
                {item.mail_error !== null && (
                  // Письмо не ушло — приглашение всё равно создано, и ссылка
                  // рядом. Ошибка названа прямо, действие не откатывается.
                  <span className="error">{t("members.mail_failed")}</span>
                )}
                {item.sent && <span className="muted">{t("members.sent")}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="settings">
        <h2>{t("members.people")}</h2>
        <ul className="members__list">
          {people.data?.map((member) => (
            <li key={member.id} className="members__row">
              {/* Имя и адрес — содержимое: не переводятся. Роль — наша чрома. */}
              <span>{member.name}</span>
              <span className="muted">{member.email}</span>
              <span>{t(`members.role.${member.role}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="settings">
        <h2>{t("members.invitations")}</h2>
        {invitations.data?.length === 0 && <p className="muted">{t("members.no_invitations")}</p>}
        <ul className="members__list">
          {invitations.data?.map((row) => (
            <li key={row.id} className="members__row">
              <span>{row.email ?? t("members.by_link")}</span>
              <span>{t(`members.role.${row.role}`)}</span>
              <span className="muted">{t(`members.status.${row.status}`)}</span>
              {row.status === "pending" && (
                <>
                  {/* «Выпустить ссылку заново» вместо «показать ссылку»:
                      показать нечего — сервер её не помнит. */}
                  <button
                    type="button"
                    className="button--quiet"
                    onClick={() => reissue.mutate(row.id)}
                  >
                    {t("members.reissue")}
                  </button>
                  <button
                    type="button"
                    className="button--quiet"
                    onClick={() => revoke.mutate(row.id)}
                  >
                    {t("members.revoke")}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

const INVITABLE_ROLES = ["editor", "viewer", "client"] as const;

function InviteForm({
  mailEnabled,
  pending,
  error,
  onSubmit,
}: {
  mailEnabled: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (payload: {
    emails: string[];
    role: string;
    project_ids?: string[];
    send_email?: boolean;
  }) => void;
}) {
  const { t } = useLocale();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const [projectIds, setProjectIds] = useState<string[]>([]);

  // Проекты нужны только роли client: остальные и так видят все проекты
  // организации, и список у них обещал бы ограничение, которого нет.
  const projects = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: listProjects,
    retry: false,
    enabled: role === "client",
  });

  const addresses = emails
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => item !== "");

  return (
    <form
      className="settings"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          emails: addresses,
          role,
          project_ids: role === "client" ? projectIds : [],
          send_email: mailEnabled,
        });
        setEmails("");
      }}
    >
      <h2>{t("members.invite")}</h2>

      <p className="field">
        <label htmlFor="invite-emails">{t("members.emails")}</label>
        {/* Пустое поле — тоже действие: приглашение по ссылке, для
            предъявителя. Об этом сказано словами, а не оставлено на догадку. */}
        <span className="muted">{t("members.emails_hint")}</span>
        <textarea
          id="invite-emails"
          name="invite-emails"
          rows={2}
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
        />
      </p>

      <p className="field">
        <label htmlFor="invite-role">{t("members.role_label")}</label>
        <select
          id="invite-role"
          name="invite-role"
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          {INVITABLE_ROLES.map((item) => (
            <option key={item} value={item}>
              {t(`members.role.${item}`)}
            </option>
          ))}
        </select>
      </p>

      {role === "client" && (
        <fieldset className="settings__fieldset">
          <legend>{t("members.projects")}</legend>
          {projects.data?.map((project) => (
            <label key={project.id} className="settings__day">
              <input
                type="checkbox"
                checked={projectIds.includes(project.id)}
                onChange={(event) =>
                  setProjectIds((current) =>
                    event.target.checked
                      ? [...current, project.id]
                      : current.filter((id) => id !== project.id),
                  )
                }
              />
              {/* Название проекта — содержимое пользователя. */}
              {project.name}
            </label>
          ))}
        </fieldset>
      )}

      {error !== null && (
        <p className="error" role="alert">
          {t(errorKey(error))}
        </p>
      )}

      <div>
        <button type="submit" disabled={pending}>
          {/* При выключенной почте кнопка отправки не показывается вовсе:
              остаётся выпуск ссылки. */}
          {mailEnabled ? t("members.invite_and_send") : t("members.invite_link_only")}
        </button>
      </div>
    </form>
  );
}
