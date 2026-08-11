import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { Live } from "./useProjectLive";

/**
 * Живая связь по умолчанию — `unavailable`, а не `offline`.
 *
 * Вне экрана проекта сокета нет вовсе: связь не оборвалась, её никто не
 * открывал. Значение по умолчанию должно называть именно это, иначе
 * какой-нибудь будущий экран без провайдера окажется молча заперт на чтение.
 */
const LiveContext = createContext<Live>({ status: "unavailable" });

export function LiveProvider({ live, children }: { live: Live; children: ReactNode }) {
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

/**
 * Состояние связи там, где о нём спрашивают вглубь дерева: у карточки задачи,
 * у полоски на ленте, у общего пути изменений.
 */
export function useLive(): Live {
  return useContext(LiveContext);
}

/** Заперто ли редактирование обрывом связи. */
export function useLiveBlocksEditing(): boolean {
  return useLive().status === "offline";
}
