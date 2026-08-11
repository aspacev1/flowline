import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import { PROJECTS_QUERY_KEY, projects } from "../api/projects";
import { useLocale } from "../i18n/LocaleProvider";

export function Projects() {
  const { t } = useLocale();
  const [showStub, setShowStub] = useState(false);

  const query = useQuery({ queryKey: PROJECTS_QUERY_KEY, queryFn: projects, retry: false });

  return (
    <main className="screen">
      <h1>{t("projects.title")}</h1>

      {query.isPending && <p role="status">{t("common.loading")}</p>}

      {query.error && (
        <p className="error" role="alert">
          {t(errorKey(query.error))}
        </p>
      )}

      {query.data?.length === 0 && (
        // Пустое состояние без кнопки было бы тупиком: человек дошёл до
        // конца онбординга и не знает, что делать дальше. Сам мастер
        // создания появится в плане 2, поэтому кнопка пока честно говорит,
        // что его ещё нет, а не притворяется работающей.
        <div className="empty">
          <p className="empty__title">{t("projects.empty.title")}</p>
          <p className="muted">{t("projects.empty.hint")}</p>
          <button type="button" onClick={() => setShowStub(true)}>
            {t("projects.create")}
          </button>
          {showStub && <p role="status">{t("projects.create_soon")}</p>}
        </div>
      )}

      {query.data && query.data.length > 0 && (
        <ul className="projects">
          {query.data.map((project) => (
            <li key={project.id}>{project.name}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
