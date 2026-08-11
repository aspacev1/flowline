import { Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./auth/RequireAuth";
import { AiIntake } from "./screens/AiIntake";
import { Invite } from "./screens/Invite";
import { Login } from "./screens/Login";
import { Members } from "./screens/Members";
import { OrgSettings } from "./screens/OrgSettings";
import { Profile } from "./screens/Profile";
import { Project } from "./screens/Project";
import { ProjectSettings } from "./screens/ProjectSettings";
import { Projects } from "./screens/Projects";
import { PublicProject } from "./screens/PublicProject";
import { Register } from "./screens/Register";
import { VerifyEmail } from "./screens/VerifyEmail";

/**
 * Маршруты отдельно от `App`, потому что в бою их оборачивает
 * `BrowserRouter`, а в тестах — `MemoryRouter`: два роутера в одном дереве
 * несовместимы, и разделение здесь избавляет тесты от подмены истории.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />
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
        <Route path="/projects" element={<Projects />} />
        {/* Интервью доступно только при создании нового проекта: запуск
            внутри существующего — следующий этап, не первая версия. */}
        <Route path="/projects/new/ai" element={<AiIntake />} />
        <Route path="/projects/:projectId" element={<Project />} />
        {/* Настройки проекта — отдельным адресом, а не окном поверх
            диаграммы: их открывают редко, надолго и обсуждая, а окно поверх
            того, что настраиваешь, показывает результат наполовину. */}
        <Route path="/projects/:projectId/settings" element={<ProjectSettings />} />
        <Route path="/settings/organization" element={<OrgSettings />} />
        <Route path="/settings/profile" element={<Profile />} />
        {/* Состав организации под двумя адресами: короткий — из шапки,
            длинный — из настроек. Экран один и тот же. */}
        <Route path="/settings/members" element={<Members />} />
        <Route path="/members" element={<Members />} />
      </Route>
      {/* Неизвестный адрес ведёт внутрь, а оттуда — на вход, если человек не
          вошёл. Отдельный экран «не найдено» появится, когда появятся адреса,
          которые можно перепутать. */}
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
