import React, { useState, useEffect } from "react";
import AuthScreen from "./components/AuthScreen.jsx";
import OnboardingScreen from "./components/OnboardingScreen.jsx";
import InviteTeammatesScreen from "./components/InviteTeammatesScreen.jsx";
import ProjectsScreen from "./components/ProjectsScreen.jsx";
import GanttScreen from "./components/GanttScreen.jsx";
import TeamScreen from "./components/TeamScreen.jsx";
import { api } from "./api.js";

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [showTeam, setShowTeam] = useState(false);
  const [showInviteScreen, setShowInviteScreen] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(setCurrentUser)
      .catch(() => setCurrentUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setCurrentUser(null);
    setActiveProjectId(null);
    setShowTeam(false);
    setShowInviteScreen(false);
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

  if (showInviteScreen) {
    return <InviteTeammatesScreen onDone={() => setShowInviteScreen(false)} />;
  }

  if (activeProjectId) {
    return (
      <GanttScreen
        projectId={activeProjectId}
        currentUser={currentUser}
        onBack={() => setActiveProjectId(null)}
      />
    );
  }

  if (showTeam) {
    return <TeamScreen onBack={() => setShowTeam(false)} />;
  }

  return (
    <ProjectsScreen
      currentUser={currentUser}
      onOpenProject={setActiveProjectId}
      onOpenTeam={() => setShowTeam(true)}
      onLogout={handleLogout}
    />
  );
}
