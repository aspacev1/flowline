import { useQuery } from "@tanstack/react-query";

import { ME_QUERY_KEY, me } from "../api/auth";
import type { User } from "../api/auth";
import { ORG_QUERY_KEY, organization } from "../api/org";
import { browserTimeZone, dayIn } from "./zone";

/**
 * Пояс, по которому этому читателю считаются сутки.
 *
 * Порядок источников — от самого личного к самому общему:
 *
 * 1. профиль — единственный, кто знает про читателя больше браузера: уехавший
 *    в отпуск или сидящий через VPN выбирает пояс руками, и его выбор обязан
 *    победить всё остальное;
 * 2. проект — пояс, в котором живёт сам план: сроки, дедлайн и «отстаёт ли
 *    задача» посчитаны в нём, и считать «сегодня» иначе значило бы сверять
 *    полоску с одной датой, а её засечку — с другой;
 * 3. организация — тот же ответ для экранов, где проекта нет вовсе: «Мои
 *    задачи», отчёты, форма новой задачи;
 * 4. браузер — когда не спросили ещё никого. Не UTC: у читателя восточнее
 *    Гринвича UTC ошибается на целые сутки каждую ночь, а часы машины — самое
 *    близкое к его стене, что есть без единого запроса.
 *
 * Профиль и организация читаются из кэша (`enabled: false`), а не
 * спрашиваются: их и так спрашивают `AuthProvider` и шапка на каждом
 * защищённом экране. Запрос отсюда уходил бы с каждой карточки задачи, а на
 * публичной странице — уходил бы в 401, которого гостю неоткуда ждать.
 */
export function useTimeZone(projectZone?: string | null): string | undefined {
  const profile = useQuery({ queryKey: ME_QUERY_KEY, queryFn: me, enabled: false });
  const org = useQuery({ queryKey: ORG_QUERY_KEY, queryFn: organization, enabled: false });

  const user = (profile.data as User | null | undefined) ?? null;
  return (
    user?.timezone ??
    projectZone ??
    org.data?.settings.default_timezone ??
    browserTimeZone()
  );
}

/**
 * Сегодняшний день в поясе читателя — `YYYY-MM-DD`, как их пишет сервер.
 *
 * Считается на отрисовке, а не по таймеру: открытая через полночь вкладка
 * узнаёт новую дату со следующим обновлением состояния. Заводить здесь
 * будильник значило бы дёргать перерисовку всей ленты ради дня, который в
 * этот час всё равно никто не смотрит.
 */
export function useToday(projectZone?: string | null): string {
  return dayIn(useTimeZone(projectZone));
}
