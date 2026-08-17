import { request } from "./client";

/** Ключ кэша настроек установки: один на всё приложение и на всю сессию. */
export const CONFIG_QUERY_KEY = ["config"] as const;

/**
 * То, что интерфейсу нужно знать об установке до всякого входа.
 *
 * Только рубильники: адресов, ключей и секретов здесь нет и быть не может —
 * маршрут открыт всякому, кто открыл страницу (backend/app/api/meta_routes.py).
 */
export type InstallConfig = {
  /**
   * Настроена ли в установке почта. Без неё письма не уходят никуда, адрес не
   * подтверждается ни у кого, и подсказку «подтвердите адрес» показывать не за
   * что: она стала бы вечной полоской, которую нечем убрать.
   */
  mail_enabled: boolean;
  signup_mode: string;
  supported_locales: string[];
  default_locale: string;
  public_sharing_enabled: boolean;
  live_enabled: boolean;
};

export function installConfig(): Promise<InstallConfig> {
  return request<InstallConfig>("/api/config");
}
