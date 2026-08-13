import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { ORG_QUERY_KEY, organization } from "../api/org";
import { useAuth } from "../auth/AuthProvider";
import { useLocale } from "../i18n/LocaleProvider";
import { OrgSwitch } from "./OrgSwitch";

/**
 * Боковая колонка приложения.
 *
 * Слева, а не сверху: разделов немного, но растут они вниз — проекты, состав,
 * настройки, — и колонка принимает новый пункт, не отбирая ширину у
 * диаграммы. Горизонтальная шапка на пятом пункте начала бы переноситься на
 * вторую строку и прыгать по высоте.
 *
 * Порядок сверху вниз — от общего к личному: организация, разделы работы,
 * человек. Разделы стоят сразу под названием организации: они — то, зачем
 * колонку открывают, и пустой строке над ними места нет. Внизу, отделённое
 * линией, всё, что относится к вошедшему, а не к делу: настройки и выход.
 * Так пункт «Выйти» не оказывается соседом пункта «Проекты», по которому
 * целятся чаще всего.
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
  const { logout } = useAuth();
  const [collapsed, setCollapsed] = useState(storedCollapsed);

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

      {/* Приветствия здесь больше нет: имя вошедшего человек знает и без
          колонки, а строка «Привет, N» отодвигала разделы на полсотни
          пикселей вниз — платить местом в самой верхней части колонки за
          вежливость не за что. */}
      <OrgSwitch />

      {/* Разделы работы — и только они. Состав организации отсюда уехал в
          настройки: приглашения и роли настраивают рабочее пространство, а не
          работу в нём, и стоять рядом с «Проектами» им незачем. Роли `client`
          часть маршрутов отвечает отказом, но ссылки остаются видимыми —
          прятать их значило бы решать про доступ на клиенте, а решает про него
          сервер. */}
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
        <NavLink to="/reports" className={navClass}>
          <IconChart />
          {t("nav.reports")}
        </NavLink>
      </nav>

      <div className="sidebar__foot">
        {/* Одна шестерёнка вместо трёх пунктов подряд. Раньше здесь стояли
            «Организация», «Настройки» (проекта) и «Профиль» — два первых с
            одинаковым значком и подписями, по которым нельзя было угадать,
            какая из них про что. Настройки проекта уехали в шапку самого
            проекта, где у слова «настройки» есть подлежащее, остальные —
            вкладками внутрь этого раздела. */}
        <NavLink to="/settings" className={navClass}>
          <IconGear />
          {t("nav.settings")}
        </NavLink>
        {/* Переключатель языка отсюда уехал в профиль — туда, где спецификация
            и держит язык интерфейса: это настройка уровня 4, а не действие
            навигации. Здесь он писал то же поле профиля, что и селект на
            экране профиля, вторым куском кода — и на экране профиля два
            одинаковых переключателя стояли бы рядом. */}
        {/* Значок слева — тот же, что у соседних пунктов: без него подпись
            «Выйти» одна съезжала влево, к краю колонки, и ряд снизу ломался.
            Дверь со стрелкой наружу говорит про выход то же, что слово, — и
            находится глазом быстрее, когда ищут именно её. */}
        <button
          type="button"
          className="button--quiet sidebar__button"
          onClick={() => void logout()}
        >
          <IconExit />
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

/* Значки нарисованы здесь, а не взяты библиотекой: их пять, каждый — восемь
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

/* Дверь и стрелка наружу: рисунок замка означал бы «заперто», а не «выйти».
   Стрелка смотрит вправо, от проёма, — по ней читается направление действия. */
function IconExit() {
  return (
    <Icon>
      <path d="M9.5 2.5h-5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h5" />
      <path d="M11 5.5 13.5 8 11 10.5" />
      <path d="M13.5 8h-6" />
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
