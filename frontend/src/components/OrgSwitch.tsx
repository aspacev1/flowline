import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ORGANIZATIONS_QUERY_KEY,
  ORG_QUERY_KEY,
  organization,
  organizations,
  switchOrganization,
} from "../api/org";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Переключатель организаций.
 *
 * Показывается, только когда организаций больше одной: у человека, который
 * никого не принимал и никуда не принят, выбора нет, и список из одного пункта
 * рядом с названием — это вопрос без ответа.
 *
 * Название организации остаётся подписью шапки; переключатель встаёт рядом,
 * а не вместо, — иначе название пропадало бы с экрана у всех остальных.
 */
export function OrgSwitch() {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ORGANIZATIONS_QUERY_KEY,
    queryFn: organizations,
    retry: false,
    staleTime: Infinity,
  });
  // Тот же ключ, что и у шапки: текущая организация уже лежит в кэше к
  // моменту, когда переключатель об этом спросит, и второго запроса не будет.
  const current = useQuery({
    queryKey: ORG_QUERY_KEY,
    queryFn: organization,
    retry: false,
    staleTime: Infinity,
  });

  const change = useMutation({
    mutationFn: switchOrganization,
    onSuccess: (org) => {
      // Организация сменилась — вместе с ней сменилось всё, что от неё
      // зависит: проекты, состав, приглашения. Точечное обновление здесь
      // означало бы список экранов, который придётся дописывать при каждом
      // новом.
      queryClient.setQueryData(ORG_QUERY_KEY, org);
      void queryClient.invalidateQueries();
    },
  });

  const items = list.data ?? [];
  if (items.length < 2) return null;

  return (
    <select
      className="org-switch"
      aria-label={t("org.switch_label")}
      value={current.data?.id ?? ""}
      onChange={(event) => change.mutate(event.target.value)}
    >
      {items.map((org) => (
        <option key={org.id} value={org.id}>
          {org.name}
        </option>
      ))}
    </select>
  );
}
