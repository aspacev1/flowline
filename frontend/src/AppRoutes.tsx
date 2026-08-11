import { Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./auth/RequireAuth";
import { Login } from "./screens/Login";
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
      {/* Публичная страница — вне RequireAuth: у гостя сессии нет, и проверка
          отправила бы его на вход вместо проекта, который ему прислали.
          Префикс `/p/` обязателен: без него `/:org/:project` перехватил бы и
          собственные адреса приложения. */}
      <Route path="/p/:orgSlug/:projectSlug" element={<PublicProject />} />
      <Route element={<RequireAuth />}>
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:projectId" element={<Project />} />
        <Route path="/projects/:projectId/settings" element={<ProjectSettings />} />
      </Route>
      {/* Неизвестный адрес ведёт внутрь, а оттуда — на вход, если человек не
          вошёл. Отдельный экран «не найдено» появится, когда появятся адреса,
          которые можно перепутать. */}
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
