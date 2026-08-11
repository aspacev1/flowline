import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { errorKey } from "../api/errors";
import {
  checkSlug,
  projectSettings,
  renameSlug,
  setShare,
  settingsQueryKey,
} from "../api/sharing";
import type { Share } from "../api/sharing";
import { useLocale } from "../i18n/LocaleProvider";
import { Switch } from "../components/Switch";

import "./settings.css";

/**
 * Настройки проекта.
 *
 * Каркас, а не одна форма: сегодня здесь публичная ссылка и адрес, завтра
 * сюда лягут дедлайн, часовой пояс и производственный календарь. Поэтому
 * разделы с подписями, а не сплошной список полей.
 */
export function ProjectSettings() {
  const { t } = useLocale();
  const { projectId = "" } = useParams();
  const client = useQueryClient();

  const query = useQuery({
    queryKey: settingsQueryKey(projectId),
    queryFn: () => projectSettings(projectId),
    retry: false,
  });

  const share = useMutation({
    mutationFn: (next: Share) => setShare(projectId, next),
    // Всё поддерево проекта: публикация меняет и то, что видно гостю.
    onSuccess: () => client.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  if (query.isPending) {
    return (
      <main className="screen">
        <p role="status">{t("common.loading")}</p>
      </main>
    );
  }

  if (query.error) {
    return (
      <main className="screen">
        <p className="error" role="alert">
          {t(errorKey(query.error))}
        </p>
      </main>
    );
  }

  const settings = query.data;
  const current = settings.share;
  // Организация может запретить публичные ссылки вовсе. Тогда переключатель
  // не просто отключён — рядом сказано, почему: неактивная ручка без
  // объяснения читается как поломка.
  const forbidden = !settings.public_sharing_enabled;

  return (
    <main className="screen">
      <div className="screen__head">
        <h1>{t("settings.title")}</h1>
        <Link to={`/projects/${projectId}`}>{t("settings.back")}</Link>
      </div>

      <section className="settings__section" aria-label={t("settings.share.title")}>
        <h2 className="settings__title">{t("settings.share.title")}</h2>

        <p className="settings__url">
          <label htmlFor="settings-url">{t("settings.share.address")}</label>
          {/* Поле только для чтения плюс кнопка, а не голый текст: адрес
              длинный, и выделять его мышью из абзаца — работа, которую делает
              одна кнопка. */}
          <input id="settings-url" type="text" readOnly value={settings.public_url} />
          <CopyButton value={settings.public_url} />
        </p>

        <Switch
          id="settings-published"
          label={t("settings.share.published")}
          checked={current.published}
          disabled={forbidden || share.isPending}
          onChange={(published) => share.mutate({ ...current, published })}
        />

        <Switch
          id="settings-comments"
          label={t("settings.share.comments")}
          checked={current.comments_enabled}
          // Комментарии в неопубликованном проекте некому оставлять: ручка,
          // меняющая ничто, обещает действие, которого нет.
          disabled={forbidden || !current.published || share.isPending}
          onChange={(comments_enabled) => share.mutate({ ...current, comments_enabled })}
        />

        {forbidden && (
          <p className="error" role="alert">
            {t("error.public_sharing_disabled")}
          </p>
        )}

        {share.error !== null && !forbidden && (
          <p className="error" role="alert">
            {t(errorKey(share.error))}
          </p>
        )}
      </section>

      <SlugSection projectId={projectId} slug={settings.slug} />
    </main>
  );
}

/**
 * Раздел адреса.
 *
 * Отдельным компонентом, потому что у него своё состояние — черновик слага и
 * живая проверка занятости, — и держать его в родителе значило бы
 * перерисовывать весь экран на каждую букву.
 */
function SlugSection({ projectId, slug }: { projectId: string; slug: string }) {
  const { t } = useLocale();
  const client = useQueryClient();
  const [draft, setDraft] = useState(slug);

  // Слаг мог измениться в ответе сервера: он его нормализует, и «Редизайн
  // 2026» возвращается как `redizayn-2026`. Поле обязано показать то, что
  // на сервере, а не то, что человек набрал.
  useEffect(() => setDraft(slug), [slug]);

  const changed = draft.trim() !== "" && draft !== slug;

  const check = useQuery({
    queryKey: ["project", projectId, "slug-check", draft],
    queryFn: () => checkSlug(projectId, draft),
    // Спрашивать про неизменённый слаг незачем: он занят самим проектом.
    enabled: changed,
    retry: false,
  });

  const rename = useMutation({
    mutationFn: () => renameSlug(projectId, draft),
    onSuccess: () => client.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  return (
    <section className="settings__section" aria-label={t("settings.slug.title")}>
      <h2 className="settings__title">{t("settings.slug.title")}</h2>

      <p className="field">
        <label htmlFor="settings-slug">{t("settings.slug.field")}</label>
        <input
          id="settings-slug"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </p>

      {/* Подсказка прямо в поле, до отправки формы: занятый слаг не должен
          выясняться нажатием кнопки. */}
      {check.data && !check.data.available && (
        <p className="settings__hint">
          {t("settings.slug.taken")}{" "}
          <button
            type="button"
            className="button--quiet"
            onClick={() => setDraft(check.data.suggestion)}
          >
            {check.data.suggestion}
          </button>
        </p>
      )}

      {/* Переименование — единственный настоящий перевыпуск ссылки при адресе
          из слагов. Человек обязан узнать об этом до нажатия, а не от клиента,
          у которого перестала открываться ссылка. */}
      <p className="muted">{t("settings.slug.warning")}</p>

      {rename.error !== null && (
        <p className="error" role="alert">
          {t(errorKey(rename.error))}
        </p>
      )}

      <button
        type="button"
        disabled={!changed || rename.isPending || check.data?.available === false}
        onClick={() => rename.mutate()}
      >
        {t("settings.slug.save")}
      </button>
    </section>
  );
}

/**
 * Копирование адреса.
 *
 * Кнопки нет вовсе, если браузер не умеет буфер обмена: `navigator.clipboard`
 * отсутствует на http и в старых браузерах, и кнопка, которая ничего не
 * делает, хуже её отсутствия — поле рядом остаётся выделяемым руками.
 */
function CopyButton({ value }: { value: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  if (typeof navigator === "undefined" || !navigator.clipboard) return null;

  return (
    <button
      type="button"
      className="button--quiet"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          // Отказ буфера обмена (нет разрешения, окно не в фокусе) ничего не
          // ломает: адрес остаётся в поле и выделяется руками.
          () => setCopied(false),
        );
      }}
    >
      {copied ? t("settings.share.copied") : t("settings.share.copy")}
    </button>
  );
}
