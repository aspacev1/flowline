import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import { approvePlan, projectQueryKey } from "../api/projects";
import type { ProjectState } from "../api/projects";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Кнопка «Утвердить план» — она же «Переутвердить».
 *
 * Две подписи у одной кнопки, а не две кнопки: действие одно, и различие
 * только в том, есть ли уже базовый план. Переутверждение доступно владельцу,
 * и решает это сервер — здесь кнопка лишь не показывается тому, кто и так
 * получит отказ.
 *
 * Переутверждение спрашивает подтверждение, а первое утверждение — нет.
 * Разница не в осторожности ради осторожности: переутверждение сдвигает базу,
 * от которой считаются все объяснённые сдвиги, то есть обнуляет накопленное
 * отставание. Первое утверждение не отменяет ничего.
 */
export function PlanApproval({
  projectId,
  state,
  canApprove,
  canReapprove,
}: {
  projectId: string;
  state: ProjectState;
  canApprove: boolean;
  canReapprove: boolean;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const approved = state.plan_approved_at !== null;

  const mutation = useMutation({
    mutationFn: () => approvePlan(projectId),
    onSuccess: async () => {
      setConfirming(false);
      // Базовые значения задач изменились у всех разом: состояние проекта
      // перезапрашивается целиком, а не правится по месту.
      await queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
    },
  });

  if (approved ? !canReapprove : !canApprove) return null;

  if (approved && confirming) {
    return (
      <span className="plan__confirm">
        <span className="muted">{t("plan.reapprove_warning")}</span>
        <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {t("plan.reapprove_confirm")}
        </button>
        <button type="button" className="button--quiet" onClick={() => setConfirming(false)}>
          {t("common.cancel")}
        </button>
      </span>
    );
  }

  return (
    <>
      {/* Приглушённая, как и остальные действия шапки проекта: заливку там
          получает только создание задачи. Утверждение плана — действие
          редкое, и постоянная синяя плашка ради него звала бы нажать себя
          каждый раз, когда человек открыл проект посмотреть. */}
      <button
        type="button"
        className="button--quiet"
        onClick={() => (approved ? setConfirming(true) : mutation.mutate())}
        disabled={mutation.isPending}
      >
        {approved
          ? t("plan.reapprove", { version: state.plan_version })
          : t("plan.approve")}
      </button>
      {mutation.error !== null && (
        <span className="error" role="alert">
          {t(errorKey(mutation.error))}
        </span>
      )}
    </>
  );
}
