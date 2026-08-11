import { Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./auth/RequireAuth";
import { Login } from "./screens/Login";
import { Project } from "./screens/Project";
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
      {/* Публичная страница живёт вне RequireAuth: у гостя нет и не будет
          сессии, а обёртка увела бы его на вход — то есть ссылка, ради
          которой всё и затевалось, не открывалась бы вовсе. */}
      <Route path="/p/:orgSlug/:projectSlug" element={<PublicProject />} />
      <Route element={<RequireAuth />}>
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:projectId" element={<Project />} />
      </Route>
      {/* Неизвестный адрес ведёт внутрь, а оттуда — на вход, если человек не
          вошёл. Отдельный экран «не найдено» появится, когда появятся адреса,
          которые можно перепутать. */}
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
