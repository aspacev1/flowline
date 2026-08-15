import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CSSProperties } from "react";

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
 * автоматически совпадение цветов на одиннадцатой категории должно чиниться,
 * а не терпеться.
 *
 * Готовый набор — это и есть весь выбор: произвольный цвет из системной
 * пипетки умеет быть неотличимым от соседнего, нечитаемым на светлой доске
 * и разным у двух людей, договорившихся «покрасить в синий». Десять
 * различимых между собой цветов закрывают задачу «отличить категории друг от
 * друга» и делают выбор делом одного щелчка.
 *
 * Ключ подписи (`name`) — машинный: сам текст живёт в словарях, потому что
 * читалка обязана назвать кружок словом на языке человека, а не кодом
 * `#3b82f6`.
 */
export const CATEGORY_COLORS = [
  { value: "#3b82f6", name: "blue" },
  { value: "#a855f7", name: "purple" },
  { value: "#f97316", name: "orange" },
  { value: "#10b981", name: "green" },
  { value: "#ef4444", name: "red" },
  { value: "#eab308", name: "yellow" },
  { value: "#06b6d4", name: "cyan" },
  { value: "#ec4899", name: "pink" },
  { value: "#64748b", name: "slate" },
  { value: "#b45309", name: "brown" },
] as const;

export function suggestColor(existing: number): string {
  return CATEGORY_COLORS[existing % CATEGORY_COLORS.length].value;
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
    <Modal
      title={t("category.new.title")}
      onClose={onClose}
      // Цвет тоже считается введённым: подобранный вручную из десяти кружков,
      // он пропадает от промаха мимо окна так же, как название.
      dirty={name !== "" || color !== suggested}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({ name: trimmed, color });
        }}
      >
        <Field id="category-name" label={t("category.new.name")} value={name} onChange={setName} />

        {/* Набор переключателей, а не список: выбран ровно один цвет, и
            стрелки клавиатуры обязаны ходить по нему сами — это поведение
            даёт браузер группе радиокнопок с общим `name`. Сам кружок — это и
            есть радиокнопка, перекрашенная в CSS: подменять её собственной
            разметкой значило бы отбирать у браузера и клавиатуру, и читалку. */}
        <fieldset className="fieldset swatches">
          <legend>{t("category.new.color")}</legend>
          <div className="swatches__row">
            {CATEGORY_COLORS.map((option) => (
              <input
                key={option.value}
                type="radio"
                className="swatch"
                name="category-color"
                value={option.value}
                checked={color === option.value}
                onChange={() => setColor(option.value)}
                aria-label={t(`category.new.colors.${option.name}`)}
                style={{ "--swatch": option.value } as CSSProperties}
              />
            ))}
          </div>
        </fieldset>

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
