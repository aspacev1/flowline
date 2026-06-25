import React, { useState, useEffect } from "react";
import AuthScreen from "./components/AuthScreen.jsx";
import OnboardingScreen from "./components/OnboardingScreen.jsx";
import InviteTeammatesScreen from "./components/InviteTeammatesScreen.jsx";
import ProjectsScreen from "./components/ProjectsScreen.jsx";
import GanttScreen from "./components/GanttScreen.jsx";
import TeamScreen from "./components/TeamScreen.jsx";
import { api } from "./api.js";

const VIEW_STORAGE_KEY = "flowline.view";

// читаем последний открытый проект/раздел, чтобы обновление страницы не сбрасывало пользователя на список проектов
function loadStoredView() {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_STORAGE_KEY) || "null") || {};
  } catch {
    return {};
  }
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(() => loadStoredView().activeProjectId || null);
  const [showTeam, setShowTeam] = useState(() => loadStoredView().showTeam || false);
  const [showInviteScreen, setShowInviteScreen] = useState(false);
  const [inviteNotice, setInviteNotice] = useState(null);

  useEffect(() => {
    api
      .me()
      .then(setCurrentUser)
      .catch(() => setCurrentUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    sessionStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ activeProjectId, showTeam }));
  }, [activeProjectId, showTeam]);

  // Ссылка-приглашение бессмысленна для тех, кто уже состоит в организации
  // (одна организация на пользователя) — сообщаем об этом и убираем токен из URL
  useEffect(() => {
    if (!authChecked || !currentUser?.organization) return;
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get("invite");
    if (!inviteToken) return;
    setInviteNotice("Эта ссылка-приглашение предназначена для новых участников — вы уже состоите в организации.");
    params.delete("invite");
    const newSearch = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""));
  }, [authChecked, currentUser]);

  const handleLogout = async () => {
    await api.logout();
    setCurrentUser(null);
    setActiveProjectId(null);
    setShowTeam(false);
    setShowInviteScreen(false);
    sessionStorage.removeItem(VIEW_STORAGE_KEY);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center">
        <p className="text-slate-400 text-[13px]">Загрузка…</p>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthScreen onAuthenticated={setCurrentUser} />;
  }

  if (!currentUser.organization) {
    const inviteToken = new URLSearchParams(window.location.search).get("invite");
    return (
      <OnboardingScreen
        inviteToken={inviteToken}
        onComplete={async (result) => {
          const refreshedUser = await api.me();
          setCurrentUser(refreshedUser);
          if (result?.becameOwner) {
            setShowInviteScreen(true);
          }
        }}
      />
    );
  }

  const noticeBanner = inviteNotice && (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-[13px] px-4 py-2 flex items-center justify-between gap-4">
      <span>{inviteNotice}</span>
      <button
        type="button"
        onClick={() => setInviteNotice(null)}
        className="text-amber-600 hover:text-amber-900 font-medium shrink-0"
      >
        Закрыть
      </button>
    </div>
  );

  if (showInviteScreen) {
    return (
      <>
        {noticeBanner}
        <InviteTeammatesScreen onDone={() => setShowInviteScreen(false)} />
      </>
    );
  }

  if (activeProjectId) {
    return (
      <>
        {noticeBanner}
        <GanttScreen
          projectId={activeProjectId}
          currentUser={currentUser}
          onBack={() => setActiveProjectId(null)}
        />
      </>
    );
  }

  if (showTeam) {
    return (
      <>
        {noticeBanner}
        <TeamScreen onBack={() => setShowTeam(false)} />
      </>
    );
  }

  return (
    <>
      {noticeBanner}
      <ProjectsScreen
        currentUser={currentUser}
        onOpenProject={setActiveProjectId}
        onOpenTeam={() => setShowTeam(true)}
        onLogout={handleLogout}
      />
    </>
  );
}
