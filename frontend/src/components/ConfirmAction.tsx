import { useEffect, useRef, useState } from "react";

import { useLocale } from "../i18n/LocaleProvider";

/**
 * Кнопка, которая перед необратимым действием разворачивает вопрос на своём
 * месте.
 *
 * Окна здесь нет намеренно: окно прерывает работу ради решения, которое человек
 * уже принял, нажав кнопку, и приучает закрывать себя не читая. Подтверждение
 * на месте отвечает на другой вопрос — не «уверены ли вы», а «вот что сейчас
 * сломается», — и стоит ровно там, куда смотрят.
 *
 * Компонент один на все такие кнопки: правил тут три (предупредить словами,
 * дать отказ, не потерять фокус), и каждый экран, изобретающий их заново,
 * ошибается в одном.
 */
export function ConfirmAction({
  label,
  warning,
  confirm,
  onConfirm,
  className,
  disabled = false,
}: {
  /** Подпись самой кнопки — до вопроса. */
  label: string;
  /** Что именно сломается. Не «вы уверены?», а последствие. */
  warning: string;
  /** Подпись подтверждения: она называет действие, а не отвечает «да». */
  confirm: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [confirming, setConfirming] = useState(false);
  const group = useRef<HTMLSpanElement>(null);

  // Фокус переходит на саму выноску, а не на кнопку подтверждения: человек с
  // клавиатуры нажимает Enter быстрее, чем читает, и подтверждение, поймавшее
  // этот же Enter, не подтверждает ничего — оно возвращает прежнее поведение,
  // добавив к нему лишнее нажатие. На кнопку отказа фокус тоже не ставится:
  // выноска сама называет последствие, и голосом оно читается первым.
  useEffect(() => {
    if (confirming) group.current?.focus();
  }, [confirming]);

  if (confirming) {
    return (
      <span className="plan__confirm" role="group" aria-label={warning} tabIndex={-1} ref={group}>
        <span className="muted">{warning}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            // Вопрос сворачивается сразу: ответ на него уже дан, а результат
            // самого действия покажет экран — ошибкой рядом или исчезновением
            // того, что удалили.
            setConfirming(false);
            onConfirm();
          }}
        >
          {confirm}
        </button>
        <button type="button" className="button--quiet" onClick={() => setConfirming(false)}>
          {t("common.cancel")}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={() => setConfirming(true)}
    >
      {label}
    </button>
  );
}
