import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import { INVITATIONS_QUERY_KEY, createInvitations, listInvitations } from "../api/invitations";
import type { Issued } from "../api/invitations";
import { PROJECTS_QUERY_KEY, listProjects } from "../api/projects";
import { useLocale } from "../i18n/LocaleProvider";
import { Modal } from "./Modal";

/**
 * Роли, которые можно выдать приглашением. Владельца среди них нет.
 *
 * Владелец распоряжается организацией целиком: удаляет проекты, переутверждает
 * планы, зовёт кого угодно. Выдавать такое выпадающим списком из четырёх слов,
 * где промах на одну строку ничем себя не выдаёт, — слишком дёшево; а
 * приглашение без адреса вдобавок достаётся предъявителю, то есть владельцем
 * становился любой, кто открыл переславшуюся ссылку. Отыграть это назад
 * нечем: смены роли участнику в продукте пока нет.
 *
 * Сервер держит то же правило сам (invitations.py), а не полагается на этот
 * список: спрятанная кнопка ничего не защищает.
 */
const ROLES = ["editor", "viewer", "client"] as const;

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
export function IssuedLink({ url }: { url: string }) {
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
 * Приглашение в организацию — вместе с окном, в котором оно живёт.
 *
 * Окно рисует сама форма, а не экран вокруг неё: тронуты ли поля, знают только
 * они, а окну этот ответ нужен, чтобы не терять набранное от промаха мимо.
 * Снаружи такой признак пришлось бы гонять обратным вызовом — то есть держать
 * состояние формы в двух местах сразу.
 *
 * Живёт в общих составляющих, а не на экране состава: зовут людей и оттуда, и
 * из шапки проекта, а вторая копия формы разошлась бы с первой на первой же
 * правке правил — например, на списке ролей, которые нельзя выдавать.
 */
export function InviteDialog({
  projectId,
  onClose,
}: {
  /**
   * Проект, из которого позвали. Роль `client` видит только отмеченные
   * проекты, и когда зовут со страницы проекта, отмечать его руками —
   * лишний шаг ровно там, где ошибиться дороже всего: клиент, приглашённый
   * без проекта, войдёт и не увидит ничего.
   */
  projectId?: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const [raw, setRaw] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const [projectIds, setProjectIds] = useState<string[]>(projectId ? [projectId] : []);
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
  // Отмеченный за человека проект, из которого позвали, при этом введённым не
  // считается: его не выбирали, и терять там нечего.
  const projectsTouched =
    projectId === undefined
      ? projectIds.length > 0
      : projectIds.length !== 1 || projectIds[0] !== projectId;
  const dirty = raw !== "" || role !== "viewer" || projectsTouched || !deliver;

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
