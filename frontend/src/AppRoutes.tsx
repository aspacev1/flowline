import { Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth } from "./auth/RequireAuth";
import { Invite } from "./screens/Invite";
import { Login } from "./screens/Login";
import { Members } from "./screens/Members";
import { Project } from "./screens/Project";
import { Projects } from "./screens/Projects";
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
        <Route path="/projects/:projectId" element={<Project />} />
        <Route path="/members" element={<Members />} />
      </Route>
      {/* Неизвестный адрес ведёт внутрь, а оттуда — на вход, если человек не
          вошёл. Отдельный экран «не найдено» появится, когда появятся адреса,
          которые можно перепутать. */}
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
