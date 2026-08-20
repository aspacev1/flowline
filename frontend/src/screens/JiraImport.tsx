import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { errorKey } from "../api/errors";
import {
  JIRA_CREDENTIAL_QUERY_KEY,
  JIRA_PROJECTS_QUERY_KEY,
  importFromJira,
  listJiraProjects,
  readJiraCredential,
} from "../api/jira";
import { PROJECTS_QUERY_KEY } from "../api/projects";
import { Field } from "../components/Field";
import { useToast } from "../components/toast";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Импорт проекта из Jira: экран, а не окно поверх списка проектов.
 *
 * Тот же выбор, что у интервью с AI (/projects/new/ai): заведение проекта —
 * не мимолётное действие, которое можно свернуть в диалог, а отдельный шаг
 * со своим состоянием загрузки — сперва список проектов Jira, потом сам
 * импорт, — и адрес экрана переживает обновление страницы.
 */
export function JiraImport() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();

  const credential = useQuery({
    queryKey: JIRA_CREDENTIAL_QUERY_KEY,
    queryFn: readJiraCredential,
    retry: false,
  });
  const configured = credential.data?.configured === true;

  const projects = useQuery({
    queryKey: JIRA_PROJECTS_QUERY_KEY,
    queryFn: listJiraProjects,
    enabled: configured,
    retry: false,
  });

  const [projectKey, setProjectKey] = useState("");
  const [name, setName] = useState("");
  // Название вводили руками — выбор другого проекта Jira больше не
  // переписывает поле поверх того, что человек уже поправил.
  const [nameTouched, setNameTouched] = useState(false);

  const importMutation = useMutation({
    mutationFn: () => importFromJira({ jira_project_key: projectKey, name: name.trim() }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
      navigate(`/projects/${result.project_id}`);
      showToast({ message: t("jira.import.imported", { name: name.trim() }) });
    },
  });

  if (credential.isPending) {
    return (
      <main className="screen">
        <p role="status">{t("common.loading")}</p>
      </main>
    );
  }

  return (
    <main className="screen">
      <div className="screen__head">
        <h1>{t("jira.import.title")}</h1>
        <Link to="/projects">{t("jira.import.back")}</Link>
      </div>

      {credential.error && (
        <p className="error" role="alert">
          {t(errorKey(credential.error))}
        </p>
      )}

      {/* Не спрятано: спрятанная форма не объясняет, почему импорт
          недоступен, — тем же правилом, что у интервью с AI. */}
      {!configured && !credential.error && (
        <>
          <p>{t("jira.not_configured")}</p>
          <Link to="/settings/organization">{t("nav.org_settings")}</Link>
        </>
      )}

      {configured && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            importMutation.mutate();
          }}
        >
          {projects.isPending && <p role="status">{t("jira.import.loading_projects")}</p>}

          {projects.error && (
            <p className="error" role="alert">
              {t(errorKey(projects.error))}
            </p>
          )}

          {projects.data && projects.data.length === 0 && (
            <p className="muted">{t("jira.import.empty_projects")}</p>
          )}

          {projects.data && projects.data.length > 0 && (
            <>
              <p className="field">
                <label htmlFor="jira-import-project">{t("jira.import.project_label")}</label>
                <select
                  id="jira-import-project"
                  value={projectKey}
                  onChange={(event) => {
                    const key = event.target.value;
                    setProjectKey(key);
                    if (!nameTouched) {
                      const picked = projects.data.find((project) => project.key === key);
                      setName(picked?.name ?? "");
                    }
                  }}
                >
                  <option value="">{t("jira.import.project_placeholder")}</option>
                  {projects.data.map((project) => (
                    <option key={project.key} value={project.key}>
                      {project.key} — {project.name}
                    </option>
                  ))}
                </select>
              </p>

              <Field
                id="jira-import-name"
                label={t("jira.import.name_label")}
                value={name}
                onChange={(value) => {
                  setNameTouched(true);
                  setName(value);
                }}
              />

              {importMutation.error && (
                <p className="error" role="alert">
                  {t(errorKey(importMutation.error))}
                </p>
              )}

              <button
                type="submit"
                disabled={projectKey === "" || name.trim() === "" || importMutation.isPending}
              >
                {t("jira.import.submit")}
              </button>
            </>
          )}
        </form>
      )}
    </main>
  );
}
