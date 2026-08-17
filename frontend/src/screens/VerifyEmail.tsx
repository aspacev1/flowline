import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { ME_QUERY_KEY, resendVerification, verifyEmail } from "../api/auth";
import { errorKey } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";
import { noteVerificationSent } from "../auth/verificationNotice";
import { useLocale } from "../i18n/LocaleProvider";

/**
 * Экран, на который ведёт ссылка из письма.
 *
 * Погашение идёт запросом с этой страницы, а не переходом по адресу самого
 * API: ссылку в письме успевают открыть до человека — почтовые сканеры и
 * предпросмотр мессенджеров ходят по всем адресам подряд, и одноразовый
 * токен сгорал бы ещё до того, как письмо прочитали.
 *
 * Открывается без сессии: почту читают не обязательно в том браузере, где
 * человек вошёл.
 */
export function VerifyEmail() {
  const { t } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  // useQuery, а не эффект: React в StrictMode монтирует дерево дважды, и
  // второй запрос пришёл бы уже с погашенным токеном — успех сменился бы
  // ошибкой на глазах у человека. Запрос с тем же ключом здесь один.
  const verification = useQuery({
    queryKey: ["verify-email", token],
    queryFn: async () => {
      const result = await verifyEmail(token);
      // Профиль в кэше держит прежний ответ /me, где адрес ещё не
      // подтверждён; без сброса подсказка осталась бы висеть до перезагрузки.
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      return result;
    },
    enabled: token !== "",
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const resend = useMutation({
    mutationFn: resendVerification,
    onSuccess: (result) => {
      // Полоска в раме приложения считает паузу от этой отметки — иначе
      // человек, ушедший отсюда к проектам, увидел бы там кнопку, которая
      // ответит «слишком часто» на письмо, отправленное секунду назад.
      if (result.sent && user) noteVerificationSent(user.email);
    },
  });

  return (
    <main className="screen screen--narrow">
      <h1>{t("auth.verify.title")}</h1>

      {token === "" && (
        <p className="error" role="alert">
          {t("auth.error.missing_token")}
        </p>
      )}

      {verification.isPending && token !== "" && (
        <p role="status">{t("auth.verify.checking")}</p>
      )}

      {/* Повторное открытие погашенной ссылки — не ошибка, а тот же успех
          другими словами: по ссылке из письма ходят дважды (из письма и из
          истории браузера, с телефона и с ноутбука), и красная плашка
          отвечала бы отказом человеку, у которого всё в порядке. */}
      {verification.isSuccess && (
        <p role="status">
          {t(verification.data.already_verified ? "auth.verify.already" : "auth.verify.done")}
        </p>
      )}

      {verification.isError && (
        <>
          <p className="error" role="alert">
            {t(errorKey(verification.error))}
          </p>
          {/* Кнопка есть только у вошедшего: письмо уходит на адрес учётной
              записи, и без сессии отправлять его некуда — а спрашивать адрес
              заново означало бы рассылать письма по чужим ящикам. */}
          {user && !user.email_verified && (
            <button type="button" disabled={resend.isPending} onClick={() => resend.mutate()}>
              {t("auth.verify.resend")}
            </button>
          )}
        </>
      )}

      {resend.isSuccess && (
        <p role="status">
          {t(resend.data.sent ? "auth.verify.resent" : "auth.verify.not_sent")}
        </p>
      )}
      {resend.isError && (
        <p className="error" role="alert">
          {t(errorKey(resend.error))}
        </p>
      )}

      <p className="muted">
        <Link to="/projects">{t("auth.verify.link_projects")}</Link>
      </p>
    </main>
  );
}
