import { useState } from "react";
import { Link } from "react-router-dom";

import { errorKey } from "../api/errors";
import type { Project, ProjectState } from "../api/projects";
import { useOrgRole } from "../auth/permissions";
import { CreateProjectActions } from "../components/CreateProjectActions";
import { Menu } from "../components/Menu";
import { Modal } from "../components/Modal";
import { projectDayNumber } from "../gantt/relative";
import { formatShortDate } from "../i18n/dates";
import { useLocale } from "../i18n/LocaleProvider";
import type { Params } from "../i18n";
import { progressOf } from "../project/progress";
import { useDeleteProject } from "../project/useDeleteProject";
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
  // Удаление — право владельца, как и в настройках проекта: редактор правит
  // план, но не расстаётся с проектом целиком. Решает всё равно сервер, здесь
  // лишь не предлагается действие, которое кончится отказом.
  const canDelete = useOrgRole() === "owner";
  // Проект, о котором задан вопрос, а не «окно открыто»: окно называет имя, и
  // держать его отдельным состоянием значило бы завести второй источник того
  // же самого. Окно одно на список: вопрос задают об одном проекте за раз.
  const [deleting, setDeleting] = useState<Project | null>(null);

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
            <ProjectCard
              key={card.project.id}
              {...card}
              onDelete={canDelete ? () => setDeleting(card.project) : undefined}
            />
          ))}
        </ul>
      )}

      {/* Окно живёт на экране, а не внутри карточки: карточка удалённого
          проекта исчезает в тот же миг, что и он сам, и окно, живущее в ней,
          унесло бы с собой отказ сервера, если тот откажет. */}
      {deleting && <DeleteProjectDialog project={deleting} onClose={() => setDeleting(null)} />}
    </main>
  );
}

/**
 * Вопрос перед удалением — окном, а не выноской на карточке.
 *
 * Окно здесь не «на всякий случай»: удаление проекта единственное действие
 * продукта, которое не отменяется ничем — вместе с проектом уходит журнал
 * ревизий, — а нажимают его в сетке одинаковых карточек, где промах на одну
 * колонку ничем не выдаёт себя. Окно называет имя проекта: это единственное
 * место, где человек может заметить, что целился в соседний.
 */
function DeleteProjectDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t } = useLocale();
  const remove = useDeleteProject({ onDeleted: onClose });

  return (
    <Modal title={t("projects.delete_title", { name: project.name })} onClose={onClose}>
      {/* Не «вы уверены?», а последствие — теми же словами, что и в настройках
          проекта: действие одно и то же, и второй набор строк однажды сказал
          бы о нём другое. */}
      <p>{t("settings.project.delete_warning")}</p>

      {remove.error !== null && (
        <p className="error" role="alert">
          {t(errorKey(remove.error))}
        </p>
      )}

      {/* Отказ стоит первым, вопреки обычному для окна порядку «главное
          действие слева»: окно ставит фокус на первый орган управления, и у
          необратимого действия первым под рукой обязан быть отказ. Enter,
          нажатый быстрее, чем прочитано предупреждение, здесь ничего не
          удаляет. */}
      <div className="modal__actions">
        <button type="button" className="button--quiet" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="button--danger"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ id: project.id, name: project.name })}
        >
          {t("settings.project.delete_confirm")}
        </button>
      </div>
    </Modal>
  );
}

function ProjectCard({
  project,
  state,
  verdict,
  onDelete,
}: {
  project: Project;
  /** Нет, пока не пришло состояние: карточка живёт и без сводки. */
  state?: ProjectState;
  verdict: Verdict | null;
  /** Нет — удалять этот проект человеку не позволено, и шестерни на карточке нет. */
  onDelete?: () => void;
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

        {/* Шестерёнка — у правого края строки с названием: действия над
            проектом целиком, а не над тем, что внутри него. Одно нажатие она
            не делает ничего необратимого — раскрывает список, — и потому
            стоит прямо на карточке, рядом с тем, к чему относится. */}
        {onDelete && (
          <Menu
            label={<GearIcon />}
            buttonClass="project-card__gear"
            showCaret={false}
            buttonLabel={t("projects.card.menu")}
          >
            <button type="button" className="menu__item menu__item--danger" onClick={onDelete}>
              {t("settings.project.delete")}
            </button>
          </Menu>
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
 * Шестерёнка: знак действий над проектом.
 *
 * Нарисована здесь, а не взята библиотекой, — как и значки колонки навигации:
 * десять строк разметки не стоят зависимости с сотней неиспользованных
 * значков.
 *
 * Обод с отверстием, а не втулка с лучами: восемь лучей вокруг точки — это
 * солнце, и в шестнадцати пикселях оно так и читается. Зубья узнаются только
 * тем, что они торчат из колеса.
 *
 * `aria-hidden`: имя кнопке даёт `buttonLabel` меню, и прочитанный вслух
 * значок повторил бы его.
 */
function GearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="4.5" />
      <circle cx="8" cy="8" r="1.7" />
      <path d="M8 3.5V1.7M8 12.5v1.8M3.5 8H1.7M12.5 8h1.8M4.82 4.82 3.55 3.55M11.18 11.18l1.27 1.27M11.18 4.82l1.27-1.27M4.82 11.18l-1.27 1.27" />
    </svg>
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
