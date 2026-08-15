import { useLocale } from "../i18n/LocaleProvider";
import { ShareControls } from "./ShareControls";

/**
 * Публичная ссылка на проект — в настройках проекта. Тело то же, что в окне
 * «Поделиться» на экране проекта: одна фича — одна реализация, иначе кнопка
 * «Копировать» или проверка `allowed` появляется только в одном из двух мест.
 */
export function SharePanel({ projectId }: { projectId: string }) {
  const { t } = useLocale();

  return (
    <section className="settings__fieldset">
      <h2>{t("share.title")}</h2>
      <ShareControls projectId={projectId} />
    </section>
  );
}
