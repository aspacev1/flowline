import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, NavLink, useMatch } from "react-router-dom";

import { ORG_QUERY_KEY, organization } from "../api/org";
import { useAuth } from "../auth/AuthProvider";
import { useCanWrite } from "../auth/permissions";
import { useLocale } from "../i18n/LocaleProvider";
import { LocaleSwitch } from "./LocaleSwitch";
import { OrgSwitch } from "./OrgSwitch";

/**
 * Боковая колонка приложения.
 *
 * Слева, а не сверху: разделов немного, но растут они вниз — проекты, состав,
 * настройки, — и колонка принимает новый пункт, не отбирая ширину у
 * диаграммы. Горизонтальная шапка на пятом пункте начала бы переноситься на
 * вторую строку и прыгать по высоте.
 *
 * Порядок сверху вниз — от общего к личному: организация и приветствие,
 * разделы работы, человек. Внизу, отделённое линией, всё, что относится к
 * вошедшему, а не к делу: профиль, язык, выход. Так пункт «Выйти» не
 * оказывается соседом пункта «Проекты», по которому целятся чаще всего.
 */
const COLLAPSED_KEY = "planora.sidebar_collapsed";

function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    // Приватный режим браузера умеет запрещать localStorage. Колонка при
    // этом просто открывается развёрнутой — это не повод падать.
    return false;
  }
}

export function Header() {
  const { t } = useLocale();
  const { user, logout } = useAuth();
  const canWrite = useCanWrite();
  const [collapsed, setCollapsed] = useState(storedCollapsed);

  // Настройки проекта показываются, только пока он открыт: ссылка ведёт по
  // его адресу, а вне проекта такого адреса попросту нет. Совпадает и с
  // самой диаграммой, и с уже открытыми настройками — второй визит на тот же
  // экран не должен прятать вход в него.
  const projectMatch = useMatch("/projects/:projectId");
  const projectSettingsMatch = useMatch("/projects/:projectId/settings");
  const projectId = projectMatch?.params.projectId ?? projectSettingsMatch?.params.projectId;

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (next) {
          localStorage.setItem(COLLAPSED_KEY, "1");
        } else {
          localStorage.removeItem(COLLAPSED_KEY);
        }
      } catch {
        // см. storedCollapsed()
      }
      return next;
    });
  };

  const org = useQuery({
    queryKey: ORG_QUERY_KEY,
    queryFn: organization,
    retry: false,
    staleTime: Infinity,
  });

  // Название организации — содержимое пользователя: оно приходит с сервера
  // как есть и не переводится ни при каком языке интерфейса. Пока оно не
  // пришло, подпись держит название продукта, а не пустота, которая дёргала
  // бы колонку по ширине.
  const title = org.data?.name ?? t("app.title");

  return (
    <header className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}>
      {/* Логотип сам сворачивает и разворачивает колонку: отдельная кнопка со
          стрелкой занимала место в самой узкой строке приложения и требовала
          прицела в 24 пикселя, а логотип — крупная мишень, которая остаётся
          видимой в обоих состояниях. */}
      <button
        type="button"
        className="sidebar__workspace"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("nav.sidebar_expand") : t("nav.sidebar_collapse")}
        title={collapsed ? t("nav.sidebar_expand") : t("nav.sidebar_collapse")}
      >
        {/* Квадрат с первой буквой — не украшение: в колонке одинаковых строк
            цветное пятно находится глазом быстрее, чем читается слово. В
            свёрнутой колонке он остаётся единственной видимой строкой — по
            нему видно, что это за приложение и чья это организация, и по нему
            же колонка разворачивается обратно. */}
        <span className="sidebar__avatar" aria-hidden="true">
          {[...title][0] ?? "F"}
        </span>
        <span className="sidebar__brand">{title}</span>
      </button>

      {/* Приветствие — сразу под логотипом и только по имени: полное имя с
          фамилией в узкой колонке обрезалось бы многоточием, а здоровается
          колонка с человеком, которого не нужно опознавать официально. */}
      {user && (
        <span className="sidebar__user">
          {t("auth.greeting", { name: user.name.trim().split(/\s+/)[0] })}
        </span>
      )}

      <OrgSwitch />

      {/* Четыре раздела. Роли `client` часть маршрутов отвечает
          отказом, но ссылки остаются видимыми — прятать их значило бы решать
          про доступ на клиенте, а решает про него сервер. */}
      <nav className="sidebar__nav">
        {/* `end`, иначе «Проекты» подсвечены на каждом адресе: все они
            начинаются с «/». */}
        <NavLink to="/" end className={navClass}>
          <IconBoard />
          {t("nav.projects")}
        </NavLink>
        <NavLink to="/my-tasks" className={navClass}>
          <IconCheck />
          {t("nav.my_tasks")}
        </NavLink>
        <NavLink to="/members" className={navClass}>
          <IconPeople />
          {t("nav.team")}
        </NavLink>
        <NavLink to="/reports" className={navClass}>
          <IconChart />
          {t("nav.reports")}
        </NavLink>
      </nav>

      <div className="sidebar__foot">
        {/* Настройки организации показываются только владельцу: остальным
            маршрут открылся бы на выключенных полях, то есть обещал бы
            действие, которого нет. */}
        {org.data?.role === "owner" && (
          <Link to="/settings/organization" className={navClass({ isActive: false })}>
            <IconGear />
            {t("nav.org_settings")}
          </Link>
        )}
        {/* Настройки проекта — тем же правом, что и кебаб на диаграмме, откуда
            эта ссылка сюда и переехала: гостю и читателю она обещала бы
            действие, которое сервер отклонит. */}
        {projectId && canWrite && (
          <Link to={`/projects/${projectId}/settings`} className={navClass({ isActive: false })}>
            <IconGear />
            {t("settings.project.link")}
          </Link>
        )}
        {user && (
          <Link to="/settings/profile" className={navClass({ isActive: false })}>
            <IconPerson />
            {t("nav.profile")}
          </Link>
        )}
        <LocaleSwitch />
        <button
          type="button"
          className="button--quiet sidebar__button"
          onClick={() => void logout()}
        >
          {t("nav.logout")}
        </button>
      </div>
    </header>
  );
}

/**
 * Текущий раздел помечается классом, а не цветом ссылки: заливка показывает
 * границы пункта целиком, и по ней видно, куда попадёт щелчок. Готовый класс
 * `active` от `NavLink` для этого не годится — он ничего не говорит о том,
 * чем пункт является, и правило пришлось бы писать через два селектора.
 */
function navClass({ isActive }: { isActive: boolean }) {
  return `sidebar__link${isActive ? " is-current" : ""}`;
}

/* Значки нарисованы здесь, а не взяты библиотекой: их четыре, каждый — восемь
   строк разметки, и ради них ставить зависимость с сотней неиспользованных
   значков не за что. Все они `aria-hidden`: рядом стоит слово, и прочитанный
   вслух значок только повторил бы его. */

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="sidebar__icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* Галочка в круге: «мои задачи» — это то, что с меня спросят. */
function IconCheck() {
  return (
    <Icon>
      <circle cx="8" cy="8" r="6" />
      <path d="m5.5 8.2 1.8 1.8 3.2-3.6" />
    </Icon>
  );
}

function IconChart() {
  return (
    <Icon>
      <path d="M2.5 13.5h11" />
      <path d="M4.5 13V8.5M8 13V4.5M11.5 13V6.5" />
    </Icon>
  );
}

function IconBoard() {
  return (
    <Icon>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M2 6h12M6.5 6v7.5" />
    </Icon>
  );
}

function IconPeople() {
  return (
    <Icon>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.5 13.5c0-2.2 2-3.5 4.5-3.5s4.5 1.3 4.5 3.5" />
      <path d="M11 3.4a2.5 2.5 0 0 1 0 4.7M12.2 10.3c1.4.5 2.3 1.6 2.3 3.2" />
    </Icon>
  );
}

/* Ползунки, а не шестерня: шестерня в шестнадцати пикселях вырождается в
   звёздочку и читается как «избранное». */
function IconGear() {
  return (
    <Icon>
      <path d="M2.5 4.5h11M2.5 11.5h11" />
      <circle cx="6" cy="4.5" r="1.8" />
      <circle cx="10.5" cy="11.5" r="1.8" />
    </Icon>
  );
}

function IconPerson() {
  return (
    <Icon>
      <circle cx="8" cy="5.5" r="2.8" />
      <path d="M2.5 14c0-2.6 2.4-4.2 5.5-4.2s5.5 1.6 5.5 4.2" />
    </Icon>
  );
}
