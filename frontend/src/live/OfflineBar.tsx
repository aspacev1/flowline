import { formatTime } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";

import "./live.css";

/**
 * Полоска «нет связи, показаны данные на 14:32».
 *
 * Время в тексте — не украшение, а единственное, что превращает предупреждение
 * в полезное: «нет связи» человек и так поймёт по неработающему перетаскиванию,
 * а вот насколько устарело то, что перед глазами, узнать больше неоткуда.
 *
 * `role="status"`, а не `alert`: связь рвётся сама, без действия человека, и
 * перебивать этим его работу с клавиатурой не за что — читалка экрана скажет о
 * полоске, когда закончит текущую фразу.
 */
export function OfflineBar({ syncedAt }: { syncedAt: number | null }) {
  const { t, locale } = useLocale();

  return (
    <p className="offline-bar" role="status">
      {syncedAt === null
        ? t("live.offline")
        : t("live.offline_since", { time: formatTime(locale, syncedAt) })}
    </p>
  );
}
