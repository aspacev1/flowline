import React, { useState, useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { api } from "../api.js";

export default function TeamScreen({ onBack }) {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getTeam()
      .then(({ departments }) => setDepartments(departments))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      <header className="bg-[#1A1D23] px-8 py-6">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors p-1">
            <ChevronLeft size={20} />
          </button>
          <span className="text-white font-semibold text-[16px] tracking-tight">Команда</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-10">
        <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight mb-1">Отделы</h1>
        <p className="text-[13.5px] text-slate-500 mb-7">
          {departments.length} отдел{departments.length === 1 ? "" : "а"}
        </p>

        {loading ? (
          <p className="text-slate-400 text-[13px]">Загрузка…</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {departments.map((dept) => (
              <div key={dept.id} className="rounded-2xl bg-white border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: dept.color }} />
                  <h3 className="text-[15px] font-semibold text-slate-900">{dept.name}</h3>
                  <span className="text-[12px] text-slate-400 ml-auto">{dept.members.length} чел.</span>
                </div>
                <div className="space-y-2">
                  {dept.members.length === 0 && (
                    <p className="text-[12.5px] text-slate-400">В отделе пока нет участников</p>
                  )}
                  {dept.members.map((p) => (
                    <div key={p.id} className="flex items-center gap-2.5">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                        style={{ backgroundColor: p.color }}
                      >
                        {p.initials}
                      </div>
                      <span className="text-[13.5px] text-slate-700">{p.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
