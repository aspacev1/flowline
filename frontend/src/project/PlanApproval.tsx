import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorKey } from "../api/errors";
import { approvePlan, projectQueryKey } from "../api/projects";
import type { ProjectState } from "../api/projects";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Кнопка «Согласовать план» — она же «Пересогласовать».
 *
 * Две подписи у одной кнопки, а не две кнопки: действие одно, и различие
 * только в том, есть ли уже базовый план. Пересогласование доступно владельцу,
 * и решает это сервер — здесь кнопка лишь не показывается тому, кто и так
 * получит отказ.
 *
 * Пересогласование спрашивает подтверждение, а первое согласование — нет.
 * Разница не в осторожности ради осторожности: пересогласование сдвигает базу,
 * от которой считаются все объяснённые сдвиги, то есть обнуляет накопленное
 * отставание. Первое согласование не отменяет ничего.
 *
 * Версии в подписи нет: кнопка стоит в строке плана, где версия уже названа
 * («ПЛАН ПРОЕКТА · V2»), и повторять её на самой кнопке значит написать одно
 * число дважды в двух сантиметрах друг от друга.
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
      {/* Контурная, а не залитая: заливку в шапке получает только создание
          задачи. Согласование плана — действие редкое, и постоянная плашка
          ради него звала бы нажать себя каждый раз, когда человек открыл
          проект посмотреть. Пересогласование при этом набрано цветом тревоги:
          оно стоит в строке, которая сообщает о расхождении, и отвечает
          именно на неё. */}
      <button
        type="button"
        className={`button--quiet${approved ? " button--alert" : ""}`}
        onClick={() => (approved ? setConfirming(true) : mutation.mutate())}
        disabled={mutation.isPending}
      >
        {approved ? t("plan.reapprove") : t("plan.approve")}
      </button>
      {mutation.error !== null && (
        <span className="error" role="alert">
          {t(errorKey(mutation.error))}
        </span>
      )}
    </>
  );
}
