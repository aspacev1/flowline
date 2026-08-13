import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  translate,
  type Locale,
  type Params,
} from "./index";

const STORAGE_KEY = "planora.locale";

type LocaleContextValue = {
  locale: Locale;
  /** Явный выбор человека: запоминается и побеждает всё остальное. */
  setLocale: (locale: Locale) => void;
  /**
   * Язык из профиля вошедшего — он же главный.
   *
   * Спор с локальным выбором невозможен по построению: всякий выбор человека
   * тут же уходит в профиль (см. LocaleSwitch и экран профиля), и локальная
   * память — это лишь то, что показать до ответа сервера и что показывать
   * гостю, у которого профиля нет вовсе. Поэтому пришедшее из профиля
   * применяется без оговорок: человек, выбравший русский на работе, обязан
   * увидеть русский и дома.
   */
  adoptProfileLocale: (locale: string) => void;
  t: (key: string, params?: Params) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function storedChoice(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isSupportedLocale(value) ? value : null;
  } catch {
    // Приватный режим браузера умеет запрещать localStorage. Язык при этом
    // просто не запоминается между сессиями — это не повод падать.
    return null;
  }
}

function fromBrowser(): Locale | null {
  // Инвариантный toLowerCase: в азербайджанской локали `toLocaleLowerCase`
  // превращает `I` в `ı`, и сравнение кодов языков начинает вести себя
  // по-разному у разных людей.
  const tag = navigator.language?.split("-")[0]?.toLowerCase();
  return isSupportedLocale(tag) ? tag : null;
}

export function LocaleProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initial ?? storedChoice() ?? fromBrowser() ?? DEFAULT_LOCALE,
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // см. storedChoice()
    }
  }, []);

  const adoptProfileLocale = useCallback(
    (next: string) => {
      if (!isSupportedLocale(next)) return;
      // Через setLocale, а не мимо него: локальная память обязана совпасть с
      // профилем, иначе следующая загрузка успеет показать прежний язык до
      // того, как сервер ответит, кто вошёл.
      setLocale(next);
    },
    [setLocale],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      adoptProfileLocale,
      t: (key, params) => translate(locale, key, params),
    }),
    [locale, setLocale, adoptProfileLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value === null) {
    throw new Error("useLocale вызван вне LocaleProvider");
  }
  return value;
}
