import React, { useState, useEffect } from "react";
import { Plus, Calendar, Clock, FolderKanban, Users, LogOut } from "lucide-react";
import { api } from "../api.js";
import { fmtDate, currentEndDate } from "../dateUtils.js";

function ProjectCard({ project, onOpen }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api
      .getWorkItems(project.id)
      .then(({ items }) => {
        const total = items.length;
        const completed = items.filter((i) => i.status === "completed").length;
        const hasBlocked = items.some((i) => i.status === "blocked" || i.status === "delayed");
        const totalHours = items.reduce((s, i) => s + i.loggedHours, 0);
        let minStart = null;
        let maxEnd = null;
        for (const i of items) {
          const start = new Date(i.start);
          const end = currentEndDate(i);
          if (!minStart || start < minStart) minStart = start;
          if (!maxEnd || end > maxEnd) maxEnd = end;
        }
        setStats({ total, completed, hasBlocked, totalHours, minStart, maxEnd });
      })
      .catch(() => setStats({ total: 0, completed: 0, hasBlocked: false, totalHours: 0 }));
  }, [project.id]);

  const avgProgress = stats && stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <button
      onClick={() => onOpen(project.id)}
      className="group relative w-full text-left rounded-2xl bg-white border border-slate-200 hover:border-slate-300 hover:shadow-lg transition-all duration-200 p-5 overflow-hidden"
    >
      <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: project.color }} />
      <div className="pl-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-slate-900 leading-snug">{project.name}</h3>
          {stats?.hasBlocked && (
            <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              есть проблемы
            </span>
          )}
        </div>

        {stats?.minStart && (
          <div className="mt-3 flex items-center gap-4 text-[12.5px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <Calendar size={13} />
              {fmtDate(stats.minStart)} — {fmtDate(stats.maxEnd)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={13} />
              {stats.totalHours} ч
            </span>
          </div>
        )}

        <div className="mt-4">
          <div className="flex items-center justify-between text-[12px] text-slate-500 mb-1.5">
            <span>{stats?.total ?? "…"} задач и подзадач</span>
            <span className="font-medium text-slate-700">{avgProgress}% завершено</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${avgProgress}%`, backgroundColor: project.color }}
            />
          </div>
        </div>
      </div>
    </button>
  );
}

export default function ProjectsScreen({ currentUser, onOpenProject, onOpenTeam, onLogout }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadProjects = () => {
    api
      .getProjects()
      .then(({ projects }) => setProjects(projects))
      .finally(() => setLoading(false));
  };

  useEffect(loadProjects, []);

  const handleCreateProject = async () => {
    const colors = ["#4F5DFF", "#2FB67C", "#E8A33D", "#E0567C"];
    const project = await api.createProject({
      name: "Новый проект",
      color: colors[projects.length % colors.length],
    });
    setProjects((prev) => [...prev, project]);
    onOpenProject(project.id);
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      <header className="bg-[#1A1D23] px-8 py-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#4F5DFF] flex items-center justify-center">
              <FolderKanban size={17} className="text-white" />
            </div>
            <span className="text-white font-semibold text-[16px] tracking-tight">Flowline</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                style={{ backgroundColor: currentUser.avatarColor }}
                title={currentUser.fullName}
              >
                {currentUser.initials}
              </div>
              <span className="text-[13px] text-slate-300">{currentUser.fullName}</span>
            </div>
            <button onClick={onLogout} className="text-slate-400 hover:text-white transition-colors" title="Выйти">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex items-end justify-between mb-7">
          <div>
            <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight">Проекты</h1>
            <p className="text-[13.5px] text-slate-500 mt-1">{projects.length} активных проекта</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenTeam}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 text-[13.5px] font-medium px-4 py-2.5 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <Users size={16} />
              Команда
            </button>
            <button
              onClick={handleCreateProject}
              className="flex items-center gap-1.5 bg-[#4F5DFF] text-white text-[13.5px] font-medium px-4 py-2.5 rounded-xl hover:bg-[#4350DB] transition-colors"
            >
              <Plus size={16} />
              Новый проект
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-slate-400 text-[13px]">Загрузка проектов…</p>
        ) : projects.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-slate-400 text-[14px]">Пока нет проектов</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} onOpen={onOpenProject} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
