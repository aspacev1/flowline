import { Link } from "react-router-dom";

import { errorKey } from "../api/errors";
import type { ProjectState } from "../api/projects";
import { useAuth } from "../auth/AuthProvider";
import { CreateProjectActions } from "../components/CreateProjectActions";
import { StatusChip } from "../components/StatusChip";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import { progressOf, statusCounts } from "../project/progress";
import { useProjectStates } from "./portfolio";

/**
 * Главная: портфель проектов одним взглядом.
 *
 * Не дубль списка проектов: тот отвечает «куда пойти», этот — «как дела».
 * Карточка несёт готовность, счётчик заблокированного и срок — три вещи,
 * ради которых человек открывает проекты по одному.
 */
export function Home() {
  const { t } = useLocale();
  const { user } = useAuth();
  const { pending, error, states } = useProjectStates();

  return (
    <main className="screen">
      <div className="screen__head">
        {/* Заголовок раздела повторяет пункт колонки, по которому сюда
            попадают: пункт зовётся «Проекты», и страница обязана называться
            так же, иначе щелчок выглядит промахом. */}
        <h1>{t("projects.title")}</h1>
        <CreateProjectActions />
      </div>

      {user && <p className="muted">{t("home.greeting", { name: user.name })}</p>}

      {pending && <p role="status">{t("common.loading")}</p>}

      {error !== null && (
        <p className="error" role="alert">
          {t(errorKey(error))}
        </p>
      )}

      {!pending && states.length === 0 && (
        <div className="empty">
          <p className="empty__title">{t("projects.empty.title")}</p>
          <p className="muted">{t("projects.empty.hint")}</p>
        </div>
      )}

      {states.length > 0 && (
        <ul className="home-cards">
          {states.map((state) => (
            <HomeCard key={state.id} state={state} />
          ))}
        </ul>
      )}
    </main>
  );
}

function HomeCard({ state }: { state: ProjectState }) {
  const { t } = useLocale();
  const progress = progressOf(state.tasks);
  const counts = statusCounts(state.tasks);

  return (
    <li className="home-card">
      {/* Название проекта — содержимое пользователя: не переводится. */}
      <Link to={`/projects/${state.id}`} className="home-card__name">
        {state.name}
      </Link>

      <p className="home-card__meta muted">
        {t("home.tasks", { count: state.tasks.length })}
        {state.deadline && <> · {t("gantt.deadline", { date: formatShortDate(t, state.deadline) })}</>}
      </p>

      {progress !== null && (
        <p
          className="home-card__progress"
          role="img"
          aria-label={t("home.progress", { pct: progress })}
        >
          <span className="home-card__bar">
            <i style={{ width: `${progress}%` }} />
          </span>
          <span className="home-card__pct">{progress}%</span>
        </p>
      )}

      {/* Заблокированное — единственный статус, вынесенный на карточку:
          остальные читаются из прогресса, а блокировка требует действия. */}
      {counts.blocked > 0 && (
        <p className="home-card__blocked">
          <StatusChip status="blocked" label={t("home.blocked", { count: counts.blocked })} />
        </p>
      )}
    </li>
  );
}
