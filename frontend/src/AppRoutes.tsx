import { Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./auth/RequireAuth";
import { AiIntake } from "./screens/AiIntake";
import { ForgotPassword } from "./screens/ForgotPassword";
import { Invite } from "./screens/Invite";
import { Login } from "./screens/Login";
import { Members } from "./screens/Members";
import { MyTasks } from "./screens/MyTasks";
import { OrgSettings } from "./screens/OrgSettings";
import { Profile } from "./screens/Profile";
import { Project } from "./screens/Project";
import { ProjectSettings } from "./screens/ProjectSettings";
import { Projects } from "./screens/Projects";
import { PublicProject } from "./screens/PublicProject";
import { Register } from "./screens/Register";
import { ResetPassword } from "./screens/ResetPassword";
import { Settings, SettingsHome } from "./screens/Settings";
import { VerifyEmail } from "./screens/VerifyEmail";

/**
 * Маршруты отдельно от `App`, потому что в бою их оборачивает
 * `BrowserRouter`, а в тестах — `MemoryRouter`: два роутера в одном дереве
 * несовместимы, и разделение здесь избавляет тесты от подмены истории.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/register" element={<Register />} />
      <Route path="/login" element={<Login />} />
      {/* Обе страницы восстановления живут вне RequireAuth: сюда приходят
          именно потому, что войти нечем, а ссылку из письма открывают в том
          браузере, куда пришла почта, — как и подтверждение адреса. */}
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Публичная страница живёт вне RequireAuth: у гостя нет и не будет
          сессии, а обёртка увела бы его на вход — то есть ссылка, ради
          которой всё и затевалось, не открывалась бы вовсе. */}
      <Route path="/p/:orgSlug/:projectSlug" element={<PublicProject />} />
      {/* Вне RequireAuth: ссылку из письма открывают в том браузере, куда
          пришла почта, и требовать там вход значило бы ломать самый обычный
          сценарий — письмо на телефоне, работа на ноутбуке. */}
      <Route path="/verify-email" element={<VerifyEmail />} />
      {/* Снаружи RequireAuth: приглашённый ещё не в системе, и отправлять его
          на вход прежде, чем он узнает, куда его зовут, — значит просить
          подписать не глядя. */}
      <Route path="/invite/:token" element={<Invite />} />
      <Route element={<RequireAuth />}>
        {/* Корень ведёт на список проектов, а не показывает свой экран: туда
            же приводит вход, туда же указывает пункт колонки, и адрес «/» —
            это то, что набирают руками и кладут в закладки. Раньше здесь жил
            второй экран с тем же заголовком «Проекты», и человек, пришедший по
            пункту меню, оказывался не там, куда его привёл вход, — на странице,
            которую ни один пункт колонки не подсвечивал. */}
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/my-tasks" element={<MyTasks />} />
        <Route path="/projects" element={<Projects />} />
        {/* Интервью доступно только при создании нового проекта: запуск
            внутри существующего — следующий этап, не первая версия. */}
        <Route path="/projects/new/ai" element={<AiIntake />} />
        <Route path="/projects/:projectId" element={<Project />} />
        {/* Предложение — вкладка того же экрана со своим адресом, по тому же
            правилу, что и история: смету обсуждают в переписке, и «открой
            предложение» должно быть ссылкой, а не инструкцией. */}
        <Route path="/projects/:projectId/proposal" element={<Project tab="proposal" />} />
        {/* История — вкладка того же экрана, но со своим адресом: на запись
            в журнале ссылаются в переписке, и «открой историю проекта»
            должно быть ссылкой, а не инструкцией из трёх шагов. */}
        <Route path="/projects/:projectId/history" element={<Project tab="history" />} />
        {/* Настройки проекта — отдельным адресом, а не окном поверх
            диаграммы: их открывают редко, надолго и обсуждая, а окно поверх
            того, что настраиваешь, показывает результат наполовину. */}
        <Route path="/projects/:projectId/settings" element={<ProjectSettings />} />
        {/* Настройки рабочего пространства — один раздел с вкладками, а не три
            соседних пункта в колонке: организация, участники и профиль
            настраивают одно и то же место работы, и разница между ними —
            вопрос уровня, а не разных разделов. */}
        <Route path="/settings" element={<Settings />}>
          <Route index element={<SettingsHome />} />
          <Route path="organization" element={<OrgSettings />} />
          <Route path="members" element={<Members />} />
          <Route path="profile" element={<Profile />} />
        </Route>
        {/* Прежний короткий адрес состава: на него уже разосланы ссылки, и
            отвечать на них «страница не найдена» из-за переезда — расплата за
            наведение порядка, которую платит читатель, а не мы. */}
        <Route path="/members" element={<Navigate to="/settings/members" replace />} />
        {/* Портфель разобран: список проектов сам отвечает «как дела» — каждая
            карточка несёт вердикт, готовность и срок. Два экрана с одним
            набором проектов и разной полнотой данных заставляли выбирать, на
            котором смотреть, и ответ «на обоих» был неверным. Адрес отвечает
            переездом, а не «страница не найдена»: по нему ходили из закладок. */}
        <Route path="/portfolio" element={<Navigate to="/projects" replace />} />
        {/* Отчёты разобраны тем же способом, что раньше портфель: их таблица
            переехала в «Проекты» и стала тем, чем этот раздел показывает
            сводку, — второго раздела с тем же набором проектов не осталось.
            Адрес отвечает переездом, а не «страница не найдена»: по нему
            ходили и из колонки, и из закладок. */}
        <Route path="/reports" element={<Navigate to="/projects" replace />} />
      </Route>
      {/* Неизвестный адрес ведёт внутрь, а оттуда — на вход, если человек не
          вошёл. Отдельный экран «не найдено» появится, когда появятся адреса,
          которые можно перепутать. */}
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
