import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { resendVerification } from "../api/auth";
import { CONFIG_QUERY_KEY, installConfig } from "../api/config";
import { errorKey } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import {
  RESEND_COOLDOWN_MS,
  noteVerificationSent,
  verificationSentAt,
} from "../auth/verificationNotice";
import { useLocale } from "../i18n/LocaleProvider";

import "./verify-bar.css";

/**
 * Полоска «адрес не подтверждён» в раме приложения.
 *
 * До неё подтверждение было призраком: письмо уходило, ссылка работала, но
 * человек, до письма не добравшийся, не видел ни слова об этом нигде в
 * приложении — состояние существовало только в базе. Полоска живёт в раме, а
 * не на одном экране, потому что не относится ни к одному из них: это
 * состояние учётной записи, и попадаться на глаза оно должно там, где человек
 * работает.
 *
 * Ничего при этом не запирает: подтверждение отвечает на вопрос «доходят ли
 * письма», а не выдаёт права (backend/app/email_verification.py). Поэтому
 * полоска — сообщение с кнопкой, а не стена поперёк работы.
 *
 * В установке без почты её нет вовсе: там письма не уходят никуда, адрес не
 * подтверждается ни у кого, и полоска висела бы вечно, ничего не предлагая.
 */
export function VerifyEmailBar() {
  const { t } = useLocale();
  const { user } = useAuth();
  const email = user?.email ?? "";
  const unverified = user !== null && !user.email_verified;

  // Спрашивается только у неподтверждённых: у остальных полоски нет, и лишний
  // поход к серверу на каждом входе не нужен ради ответа, который никто не
  // прочитает.
  const config = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: installConfig,
    enabled: unverified,
    retry: false,
    staleTime: Infinity,
  });

  const [sentAt, setSentAt] = useState<number | null>(() => verificationSentAt(email));
  const secondsLeft = useCooldown(sentAt);

  const resend = useMutation({
    mutationFn: resendVerification,
    onSuccess: (result) => {
      // Только ушедшее письмо заводит паузу — и здесь, и на сервере. Обещать
      // «письмо отправлено» после отказа доставки значило бы отправить
      // человека ждать то, чего нет.
      if (!result.sent) return;
      noteVerificationSent(email);
      setSentAt(Date.now());
    },
  });

  if (!unverified || config.data?.mail_enabled !== true) return null;

  const waiting = secondsLeft > 0;

  return (
    <div className="verify-bar">
      {/* role="status", а не alert: адрес не подтверждается сам собой в
          середине работы, и перебивать этим чтение экрана не за что. */}
      <p className="verify-bar__text" role="status">
        {waiting
          ? t("auth.verify.sent_to", { email })
          : t("auth.verify.unverified", { email })}
      </p>

      {/* Пока идёт пауза, кнопка выключена и сама говорит, сколько ждать:
          включённая, она ответила бы «слишком часто» — отказом на действие,
          которое сама же и предложила. */}
      <button
        type="button"
        className="button--quiet verify-bar__button"
        disabled={waiting || resend.isPending}
        onClick={() => resend.mutate()}
      >
        {waiting
          ? t("auth.verify.resend_in", { seconds: secondsLeft })
          : t("auth.verify.resend")}
      </button>

      {resend.data?.sent === false && (
        <p className="verify-bar__note" role="alert">
          {t("auth.verify.not_sent")}
        </p>
      )}
      {resend.isError && (
        <p className="verify-bar__note" role="alert">
          {t(errorKey(resend.error))}
        </p>
      )}
    </div>
  );
}

/**
 * Секунды до конца паузы. 0 — пауза кончилась или её не было.
 *
 * Отсчёт держится на `setTimeout`, который перезаводится с каждой секундой и
 * не заводится вовсе на нуле: постоянный интервал в раме приложения будил бы
 * React каждую секунду всю сессию — ради строки, которой на экране нет.
 */
function useCooldown(sentAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  const left =
    sentAt === null ? 0 : Math.max(0, Math.ceil((sentAt + RESEND_COOLDOWN_MS - now) / 1000));

  useEffect(() => {
    if (left === 0) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  return left;
}
