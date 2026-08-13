import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { errorKey } from "../api/errors";
import { PROJECTS_QUERY_KEY, listProjects } from "../api/projects";
import { CreateProjectActions } from "../components/CreateProjectActions";
import { useLocale } from "../i18n/LocaleProvider";

export function Projects() {
  const { t } = useLocale();

  const query = useQuery({ queryKey: PROJECTS_QUERY_KEY, queryFn: listProjects, retry: false });

  return (
    <main className="screen">
      <div className="screen__head">
        <h1>{t("projects.title")}</h1>
        <CreateProjectActions />
      </div>

      {query.isPending && <p role="status">{t("common.loading")}</p>}

      {query.error && (
        <p className="error" role="alert">
          {t(errorKey(query.error))}
        </p>
      )}

      {query.data?.length === 0 && (
        <div className="empty">
          <p className="empty__title">{t("projects.empty.title")}</p>
          <p className="muted">{t("projects.empty.hint")}</p>
        </div>
      )}

      {query.data && query.data.length > 0 && (
        <ul className="projects">
          {query.data.map((project) => (
            <li key={project.id}>
              <Link to={`/projects/${project.id}`}>{project.name}</Link>
              {/* Слаг показывается ровно тем, что прислал сервер. Собрать его
                  в браузере по своей таблице транслитерации нельзя: правило
                  живёт на сервере, и расхождение дало бы ссылку, которая
                  никуда не ведёт. */}
              <span className="muted projects__slug">{project.slug}</span>
            </li>
          ))}
        </ul>
      )}

    </main>
  );
}
