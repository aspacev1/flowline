import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { errorKey } from "../api/errors";
import { PROJECTS_QUERY_KEY, createProject, listProjects } from "../api/projects";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { useLocale } from "../i18n/LocaleProvider";

export function Projects() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const query = useQuery({ queryKey: PROJECTS_QUERY_KEY, queryFn: listProjects, retry: false });

  const create = useMutation({
    mutationFn: (candidate: string) => createProject(candidate),
    onSuccess: (project) => {
      // Список инвалидируется, а не дописывается вручную: сервер вернул слаг,
      // который сам же и построил, и складывать рядом с ним придуманные
      // клиентом поля значит держать в кэше запись, которой на сервере нет.
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
      navigate(`/projects/${project.id}`);
    },
  });

  const trimmed = name.trim();

  function close() {
    setOpen(false);
    setName("");
    create.reset();
  }

  return (
    <main className="screen">
      <div className="screen__head">
        <h1>{t("projects.title")}</h1>
        <button type="button" onClick={() => setOpen(true)}>
          {t("projects.create")}
        </button>
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

      {open && (
        <Modal title={t("projects.new.title")} onClose={close}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(trimmed);
            }}
          >
            <Field id="project-name" label={t("projects.new.name")} value={name} onChange={setName} />

            {create.error && (
              <p className="error" role="alert">
                {t(errorKey(create.error))}
              </p>
            )}

            <div className="modal__actions">
              <button type="submit" disabled={trimmed === "" || create.isPending}>
                {t("common.create")}
              </button>
              <button type="button" className="button--quiet" onClick={close}>
                {t("common.cancel")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}
