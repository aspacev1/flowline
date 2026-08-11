import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { errorKey } from "../api/errors";
import { getProject, projectQueryKey } from "../api/projects";
import { Gantt } from "../gantt/Gantt";
import { useLocale } from "../i18n/LocaleProvider";
import { CategoryForm, suggestColor } from "./CategoryForm";
import { TaskForm } from "./TaskForm";

/**
 * Экран одного проекта.
 *
 * Три явных состояния, а не два: пока состояние не пришло, показывать пустую
 * диаграмму нельзя — она читается как «в проекте ничего нет». Отказ 404
 * означает и несуществующий проект, и чужой: интерфейс не знает разницы и не
 * притворяется, что знает.
 */
export function Project() {
  const { t } = useLocale();
  const { projectId = "" } = useParams();
  const [addingCategory, setAddingCategory] = useState(false);
  // Категория, из строки которой открыли форму задачи. `null` — форма закрыта.
  const [addingTaskIn, setAddingTaskIn] = useState<string | null>(null);

  const query = useQuery({
    queryKey: projectQueryKey(projectId),
    queryFn: () => getProject(projectId),
    retry: false,
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

  return (
    <main className="screen screen--wide">
      <div className="screen__head">
        {/* Название проекта — содержимое пользователя: приходит с сервера как
            есть и не переводится ни при каком языке интерфейса. */}
        <h1>{query.data.name}</h1>

        <div className="screen__actions">
          <button type="button" onClick={() => setAddingCategory(true)}>
            {t("category.create")}
          </button>
          {/* Задачу некуда класть, пока нет ни одной категории: кнопка,
              открывающая форму с пустым списком категорий, обещает действие,
              которое не может состояться. */}
          {query.data.categories.length > 0 && (
            <button
              type="button"
              onClick={() => setAddingTaskIn(query.data.categories[0].id)}
            >
              {t("task.create")}
            </button>
          )}
        </div>
      </div>

      <Gantt state={query.data} onAddTask={setAddingTaskIn} />

      {addingCategory && (
        <CategoryForm
          projectId={projectId}
          suggested={suggestColor(query.data.categories.length)}
          onClose={() => setAddingCategory(false)}
        />
      )}

      {addingTaskIn !== null && (
        <TaskForm
          projectId={projectId}
          categories={query.data.categories}
          initialCategoryId={addingTaskIn}
          onClose={() => setAddingTaskIn(null)}
        />
      )}
    </main>
  );
}
