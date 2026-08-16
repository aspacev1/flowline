import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import { createProposalCategory, proposalQueryKey } from "../api/proposal";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Окно нового раздела сметы — тем же движением, что категория плана
 * (CategoryForm): кнопка в тулбаре, окно с полями, «Создать».
 *
 * Отличий от категории плана два, и оба — от природы сметы. Цвета нет:
 * раздел сметы не рисуется полосой на диаграмме, и выбирать ему цвет не для
 * чего. Регистр не поднимается: строка раздела в таблице — не заголовок
 * группы в ленте, а строка с описанием и суммой, и прописные здесь кричали
 * бы посреди документа, который показывают клиенту.
 */
export function ProposalCategoryForm({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: () => createProposalCategory(projectId, name.trim(), description.trim()),
    onSuccess: async () => {
      // Перезапрос, а не дописывание в кэш: идентификатор и позицию назначил
      // сервер — тот же довод, что у категории плана.
      await queryClient.invalidateQueries({ queryKey: proposalQueryKey(projectId) });
      onClose();
    },
  });

  return (
    <Modal
      title={t("proposal.category.new_title")}
      onClose={onClose}
      dirty={name !== "" || description !== ""}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === "") return;
          create.mutate();
        }}
      >
        <Field
          id="proposal-category-name"
          label={t("proposal.category.name")}
          value={name}
          onChange={setName}
        />
        {/* Описание — по желанию: строка о разделе целиком, она встанет на
            его строке в таблице рядом с суммой работ. */}
        <Field
          id="proposal-category-description"
          label={t("proposal.category.description")}
          value={description}
          onChange={setDescription}
        />

        {create.error !== null && (
          <p className="error" role="alert">
            {t(errorKey(create.error))}
          </p>
        )}

        <div className="modal__actions">
          <button type="submit" disabled={name.trim() === "" || create.isPending}>
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
