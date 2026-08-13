import { Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./auth/RequireAuth";
import { AiIntake } from "./screens/AiIntake";
import { Home } from "./screens/Home";
import { Invite } from "./screens/Invite";
import { Login } from "./screens/Login";
import { Members } from "./screens/Members";
import { MyTasks } from "./screens/MyTasks";
import { Reports } from "./screens/Reports";
import { OrgSettings } from "./screens/OrgSettings";
import { Profile } from "./screens/Profile";
import { Project } from "./screens/Project";
import { ProjectSettings } from "./screens/ProjectSettings";
import { Projects } from "./screens/Projects";
import { PublicProject } from "./screens/PublicProject";
import { Register } from "./screens/Register";
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
        {/* Корень — «Главная», а не редирект на проекты: раздел свой, с
            портфелем и приветствием, как в макете. */}
        <Route path="/" element={<Home />} />
        <Route path="/my-tasks" element={<MyTasks />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/projects" element={<Projects />} />
        {/* Интервью доступно только при создании нового проекта: запуск
            внутри существующего — следующий этап, не первая версия. */}
        <Route path="/projects/new/ai" element={<AiIntake />} />
        <Route path="/projects/:projectId" element={<Project />} />
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
      </Route>
      {/* Неизвестный адрес ведёт внутрь, а оттуда — на вход, если человек не
          вошёл. Отдельный экран «не найдено» появится, когда появятся адреса,
          которые можно перепутать. */}
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
