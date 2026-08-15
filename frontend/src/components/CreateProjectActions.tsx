import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { errorKey } from "../api/errors";
import { PROJECTS_QUERY_KEY, createProject } from "../api/projects";
import { useLocale } from "../i18n/LocaleProvider";
import { Field } from "./Field";
import { Modal } from "./Modal";
import { useToast } from "./toast";

/**
 * Два способа завести проект — обычный и через интервью — одной парой кнопок.
 *
 * Общий компонент, а не копия на каждом экране: список проектов и портфель
 * начинаются с одного и того же вопроса «а если проекта ещё нет?», и разойтись
 * в подписях или в поведении окна им не за что.
 */
export function CreateProjectActions() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: (candidate: string) => createProject(candidate),
    onSuccess: (project) => {
      // Список инвалидируется, а не дописывается вручную: сервер вернул слаг,
      // который сам же и построил, и складывать рядом с ним придуманные
      // клиентом поля значит держать в кэше запись, которой на сервере нет.
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
      navigate(`/projects/${project.id}`);
      // Тост переживает переход: он висит на раме приложения, а не на экране
      // списка. Пустая диаграмма после нажатия одинаково похожа и на новый
      // проект, и на промах мимо кнопки — название в тосте различает их.
      showToast({ message: t("projects.created", { name: project.name }) });
    },
  });

  const trimmed = name.trim();

  function close() {
    setOpen(false);
    setName("");
    create.reset();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {t("projects.create")}
      </button>
      {/* Интервью — только для нового проекта: внутри существующего его
          запуск в первую версию не входит. Ссылка выглядит кнопкой в рамке:
          рядом с залитой синей плашкой это второй способ сделать то же самое,
          а не сноска под ней. */}
      <Link to="/projects/new/ai" className="button-link">
        {t("projects.create_with_ai")}
      </Link>

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
    </>
  );
}
