import { useLocale } from "../i18n/LocaleProvider";

export function Projects() {
  const { t } = useLocale();

  return (
    <main className="screen">
      <h1>{t("projects.title")}</h1>
    </main>
  );
}
