import { Link } from "react-router-dom";

import { errorKey } from "../api/errors";
import type { ProjectState } from "../api/projects";
import { useAuth } from "../auth/AuthProvider";
import { CreateProjectActions } from "../components/CreateProjectActions";
import { StatusChip } from "../components/StatusChip";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { progressOf, statusCounts } from "../project/progress";
import { useProjectStates } from "./projectStates";

/**
 * «Портфель»: все проекты одним взглядом.
 *
 * Не дубль списка проектов: тот отвечает «куда пойти», этот — «как дела».
 * Карточка несёт готовность, счётчик заблокированного и срок — три вещи,
 * ради которых человек открывает проекты по одному.
 *
 * Раздел зовётся «Портфель», а не «Проекты», и живёт по своему адресу: пока
 * два экрана носили одно имя и одинаковый заголовок, щелчок по «Проектам»
 * уводил не туда, куда приводил вход, и человек не мог понять, на котором из
 * них он стоит. Имя здесь — не украшение, а единственное, чем эти два экрана
 * различимы снаружи.
 */
export function Portfolio() {
  const { t } = useLocale();
  const { user } = useAuth();
  const { pending, error, states } = useProjectStates();

  return (
    <main className="screen">
      <div className="screen__head">
        <h1>{t("portfolio.title")}</h1>
        <CreateProjectActions />
      </div>

      {user && <p className="muted">{t("portfolio.greeting", { name: user.name })}</p>}

      {pending && <p role="status">{t("common.loading")}</p>}

      {error !== null && (
        <p className="error" role="alert">
          {t(errorKey(error))}
        </p>
      )}

      {!pending && error === null && states.length === 0 && (
        <div className="empty">
          <p className="empty__title">{t("projects.empty.title")}</p>
          <p className="muted">{t("projects.empty.hint")}</p>
        </div>
      )}

      {states.length > 0 && (
        <ul className="portfolio-cards">
          {states.map((state) => (
            <PortfolioCard key={state.id} state={state} />
          ))}
        </ul>
      )}
    </main>
  );
}

function PortfolioCard({ state }: { state: ProjectState }) {
  const { t } = useLocale();
  const progress = progressOf(state.tasks);
  const counts = statusCounts(state.tasks);

  return (
    <li className="portfolio-card">
      {/* Название проекта — содержимое пользователя: не переводится. */}
      <Link to={`/projects/${state.id}`} className="portfolio-card__name">
        {state.name}
      </Link>

      <p className="portfolio-card__meta muted">
        {t("portfolio.tasks", { count: state.tasks.length })}
        {state.deadline && (
          <> · {t("gantt.deadline", { date: formatShortDate(t, state.deadline) })}</>
        )}
      </p>

      {progress !== null && (
        <p
          className="portfolio-card__progress"
          role="img"
          aria-label={t("portfolio.progress", { pct: progress })}
        >
          <span className="portfolio-card__bar">
            <i style={{ width: `${progress}%` }} />
          </span>
          <span className="portfolio-card__pct">{progress}%</span>
        </p>
      )}

      {/* Заблокированное — единственный статус, вынесенный на карточку:
          остальные читаются из прогресса, а блокировка требует действия. */}
      {counts.blocked > 0 && (
        <p className="portfolio-card__blocked">
          <StatusChip status="blocked" label={t("portfolio.blocked", { count: counts.blocked })} />
        </p>
      )}
    </li>
  );
}
