import { useQuery } from "@tanstack/react-query";

import { ORG_QUERY_KEY, organization } from "../api/org";

/**
 * Роли, которым позволено менять проект. Список повторяет матрицу прав
 * сервера — и повторяет её сознательно, а не заменяет: решает всё равно
 * сервер, а здесь решается только то, показывать ли ручку перетаскивания и
 * открывать ли поля на правку.
 *
 * Разница важна: интерфейс, спрятавший кнопку, ничего не защищает — он лишь
 * не предлагает человеку действие, которое всё равно кончится отказом.
 */
const WRITERS = new Set(["owner", "editor"]);

export function roleCanWrite(role: string | undefined | null): boolean {
  return typeof role === "string" && WRITERS.has(role);
}

/**
 * Может ли текущий человек менять проекты своей организации.
 *
 * Ключ запроса тот же, что и у шапки, — состав организации не запрашивается
 * второй раз: ответ уже лежит в кэше к моменту, когда экран проекта об этом
 * спросит.
 */
export function useCanWrite(): boolean {
  const org = useQuery({
    queryKey: ORG_QUERY_KEY,
    queryFn: organization,
    retry: false,
    staleTime: Infinity,
  });
  return roleCanWrite(org.data?.role);
}
