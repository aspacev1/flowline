import { useLayoutEffect, useRef, useState } from "react";

/**
 * Нативный tooltip с полным текстом — но только когда текст обрезан
 * многоточием.
 *
 * Не обрезанный текст своего тултипа не получает: подсказка, повторяющая то,
 * что и так дочитано глазами, — лишний слой между курсором и ответом.
 *
 * @param text текст, который может быть обрезан
 * @param watch что ещё, кроме текста, меняет доступную ширину и потому обязано
 *   перезапускать проверку — у ленты это ширина колонки названия: её тянут за
 *   границу, и имя, влезавшее секунду назад, может обрезаться без единой
 *   правки самого текста.
 */
export function useTruncatedTitle<T extends HTMLElement>(text: string, watch?: unknown) {
  const ref = useRef<T>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    // Запас в один пиксель — округление ширины при дробном масштабе экрана
    // иначе засчитывало бы точно влезающее имя как обрезанное.
    setTruncated(el !== null && el.scrollWidth > el.clientWidth + 1);
  }, [text, watch]);

  return { ref, title: truncated ? text : undefined };
}
