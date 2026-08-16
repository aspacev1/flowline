import { Link } from "react-router-dom";

import { errorKey } from "../api/errors";
import type { Project, ProjectState } from "../api/projects";
import { CreateProjectActions } from "../components/CreateProjectActions";
import { projectDayNumber } from "../gantt/relative";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import type { Params } from "../i18n";
import { progressOf } from "../project/progress";
import { projectVerdict, severityOf } from "../project/verdict";
import type { Verdict } from "../project/verdict";
import { useToday } from "../time/useToday";
import { useProjectStates } from "./projectStates";

/**
 * Проекты: единственный список проектов и единственный ответ на «как дела».
 *
 * Раньше эти две работы делали два экрана — список и «Портфель», — и человек
 * не мог понять, на котором из них стоит: один заголовок, один набор проектов,
 * разная полнота данных. Портфель убран, его сводка переехала сюда: на
 * карточку смотрят, чтобы решить, куда идти, и «куда идти» решается тем, где
 * горит.
 *
 * Сортировка по срочности — только когда сводка собралась целиком: карточки,
 * пересобирающиеся по мере прихода ответов, уезжают из-под курсора у того, кто
 * уже целится в одну из них.
 */
export function Projects() {
  const { t } = useLocale();
  // Проектов здесь много, и у каждого мог быть свой пояс: просрочка на общем
  // списке считается по суткам читателя, а не по суткам одного из них.
  const today = useToday();
  const { pending, listPending, listError, projects, stateById } = useProjectStates();

  const cards = projects.map((project) => {
    const state = stateById.get(project.id);
    return { project, state, verdict: state ? projectVerdict(state, today) : null };
  });
  if (!pending) {
    // Сортировка устойчива: у карточек с одинаковой срочностью остаётся
    // порядок, в котором их прислал сервер.
    cards.sort((a, b) => severityOf(b.verdict) - severityOf(a.verdict));
  }

  return (
    <main className="screen">
      <div className="screen__head">
        <h1>{t("projects.title")}</h1>
        <CreateProjectActions />
      </div>

      {listPending && <p role="status">{t("common.loading")}</p>}

      {listError !== null && (
        <p className="error" role="alert">
          {t(errorKey(listError))}
        </p>
      )}

      {!listPending && listError === null && projects.length === 0 && (
        <div className="empty">
          <p className="empty__title">{t("projects.empty.title")}</p>
          <p className="muted">{t("projects.empty.hint")}</p>
        </div>
      )}

      {cards.length > 0 && (
        <ul className="projects">
          {cards.map((card) => (
            <ProjectCard key={card.project.id} {...card} />
          ))}
        </ul>
      )}
    </main>
  );
}

function ProjectCard({
  project,
  state,
  verdict,
}: {
  project: Project;
  /** Нет, пока не пришло состояние: карточка живёт и без сводки. */
  state?: ProjectState;
  verdict: Verdict | null;
}) {
  const { t } = useLocale();
  const progress = state ? progressOf(state.tasks) : null;

  return (
    <li className="project-card">
      {/* Вердикт — первой строкой, на месте, где раньше стояла нарисованная
          в CSS полоска: она была одинаковой на всех карточках, но читалась
          как готовность проекта. Единственный знак наверху карточки обязан
          что-то значить. */}
      {verdict && (
        <p className="project-card__verdict" data-tone={verdict.tone}>
          {verdictLabel(t, verdict)}
        </p>
      )}

      <div className="project-card__head">
        {/* Название проекта — содержимое пользователя: не переводится. */}
        <Link to={`/projects/${project.id}`} className="project-card__name">
          {project.name}
        </Link>
        {/* Режим плана — не вердикт, а состояние: вердикт зовёт назначить дату
            старта, плашка объясняет, почему на карточке нет ни одной. */}
        {state?.schedule_mode === "relative" && (
          <span className="project-card__mode">{t("projects.mode.relative")}</span>
        )}
      </div>

      {/* Слаг показывается ровно тем, что прислал сервер. Собрать его
          в браузере по своей таблице транслитерации нельзя: правило
          живёт на сервере, и расхождение дало бы ссылку, которая
          никуда не ведёт. */}
      <p className="project-card__slug muted">{project.slug}</p>

      {state && (
        <p className="project-card__meta muted">
          {t("projects.card.tasks", { count: state.tasks.length })}
          <CardPeriod state={state} />
        </p>
      )}

      {progress !== null && (
        <p
          className="project-card__progress"
          role="img"
          aria-label={t("projects.card.progress", { pct: progress })}
        >
          <span className="project-card__bar">
            <i style={{ width: `${progress}%` }} />
          </span>
          <span className="project-card__pct">{progress}%</span>
        </p>
      )}
    </li>
  );
}

/**
 * Хвост строки сводки: дедлайн у календарного плана, длина плана у
 * относительного.
 *
 * У плана без дат настоящих сроков нет, и подставить сюда координату оси
 * значило бы назвать выдуманную дату. Длина в днях — то, что про такой план
 * известно достоверно.
 */
function CardPeriod({ state }: { state: ProjectState }) {
  const { t } = useLocale();

  if (state.schedule_mode === "relative") {
    const days = planLengthDays(state);
    if (days === null) return null;
    return <> · {t("projects.card.plan_days", { days: t("common.days", { count: days }) })}</>;
  }

  if (state.deadline === null) return null;
  return <> · {t("gantt.deadline", { date: formatShortDate(t, state.deadline) })}</>;
}

/** Номер последнего занятого дня относительного плана. `null` — плана нет. */
function planLengthDays(state: ProjectState): number | null {
  if (state.tasks.length === 0) return null;
  // Строки ISO сравниваются лексикографически ровно как даты.
  const last = state.tasks.map((task) => task.end_date).reduce((a, b) => (a > b ? a : b));
  return projectDayNumber(last);
}

/**
 * Подпись вердикта. Живёт здесь, а не в `verdict.ts`: тот считает состояние,
 * а словарь — дело экрана, который его показывает.
 */
function verdictLabel(t: (key: string, params?: Params) => string, verdict: Verdict): string {
  if (verdict.days !== undefined) {
    return t(`projects.verdict.${verdict.kind}`, {
      days: t("common.days", { count: verdict.days }),
    });
  }
  if (verdict.count !== undefined) {
    return t(`projects.verdict.${verdict.kind}`, { count: verdict.count });
  }
  return t(`projects.verdict.${verdict.kind}`);
}
