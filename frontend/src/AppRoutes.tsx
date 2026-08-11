import { Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./auth/RequireAuth";
import { AcceptInvite } from "./screens/AcceptInvite";
import { AiIntake } from "./screens/AiIntake";
import { Login } from "./screens/Login";
import { Members } from "./screens/Members";
import { OrgSettings } from "./screens/OrgSettings";
import { Profile } from "./screens/Profile";
import { Project } from "./screens/Project";
import { ProjectSettings } from "./screens/ProjectSettings";
import { Projects } from "./screens/Projects";
import { PublicProject } from "./screens/PublicProject";
import { Register } from "./screens/Register";

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
      {/* Приём приглашения — снаружи RequireAuth: человек с ссылкой на руках
          должен увидеть, куда его зовут, прежде чем заводить аккаунт. */}
      <Route path="/invite/:token" element={<AcceptInvite />} />
      {/* Публичная страница: слаги в адресе ради читаемости, токен — в
          параметре, потому что без него отзыв ссылки неисполним. Сессии не
          требует вовсе. */}
      <Route path="/p/:orgSlug/:projectSlug" element={<PublicProject />} />
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
        <Route path="/settings/members" element={<Members />} />
        <Route path="/settings/profile" element={<Profile />} />
      </Route>
      {/* Неизвестный адрес ведёт внутрь, а оттуда — на вход, если человек не
          вошёл. Отдельный экран «не найдено» появится, когда появятся адреса,
          которые можно перепутать. */}
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
