import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import { applyOp, projectQueryKey } from "../api/projects";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Палитра для новых категорий.
 *
 * Живёт в браузере, а не на сервере: это оформление, а не свойство плана.
 * Предлагается по числу уже существующих категорий — так две подряд созданные
 * категории не оказываются одного цвета, и человеку не приходится подбирать
 * цвет вручную каждый раз. Выбор всё равно остаётся за ним: подобранное
 * автоматически совпадение цветов на восьмой категории должно чиниться, а не
 * терпеться.
 */
export const CATEGORY_COLORS = [
  "#3b82f6",
  "#a855f7",
  "#f97316",
  "#10b981",
  "#ef4444",
  "#eab308",
  "#06b6d4",
  "#ec4899",
];

export function suggestColor(existing: number): string {
  return CATEGORY_COLORS[existing % CATEGORY_COLORS.length];
}

export function CategoryForm({
  projectId,
  suggested,
  onClose,
}: {
  projectId: string;
  suggested: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState(suggested);

  const create = useMutation({
    mutationFn: (payload: { name: string; color: string }) =>
      applyOp(projectId, { type: "create_category", name: payload.name, color: payload.color }),
    onSuccess: async () => {
      // Состояние перезапрашивается целиком, а не дописывается руками в кэш.
      // Идентификатор и позицию назначил сервер; сочинить их на клиенте
      // значит завести в кэше строку, которой на сервере нет, — и узнать об
      // этом при первом же действии над ней.
      await queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
      onClose();
    },
  });

  const trimmed = name.trim();

  return (
    <Modal title={t("category.new.title")} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({ name: trimmed, color });
        }}
      >
        <Field id="category-name" label={t("category.new.name")} value={name} onChange={setName} />

        <p className="field">
          <label htmlFor="category-color">{t("category.new.color")}</label>
          <input
            id="category-color"
            name="category-color"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </p>

        {create.error && (
          <p className="error" role="alert">
            {t(errorKey(create.error))}
          </p>
        )}

        <div className="modal__actions">
          <button type="submit" disabled={trimmed === "" || create.isPending}>
            {t("common.create")}
          </button>
          <button type="button" className="button--quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
