import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api.js";

function PersonCheckbox({ person, checked, onToggle }) {
  return (
    <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(person.id)}
        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-300"
      />
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
        style={{ backgroundColor: person.color }}
      >
        {person.initials}
      </span>
      <span className="text-[13px] text-slate-700">{person.name}</span>
    </label>
  );
}

function PeoplePicker({ groups, unassigned, selected, onToggle }) {
  return (
    <div className="space-y-2.5 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2">
      {groups.map((dept) => (
        <div key={dept.id}>
          <div className="flex items-center gap-1.5 mb-1 px-2.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dept.color }} />
            <span className="text-[10.5px] font-medium text-slate-400 uppercase tracking-wide">{dept.name}</span>
          </div>
          {dept.members.map((p) => (
            <PersonCheckbox key={p.id} person={p} checked={selected.has(p.id)} onToggle={onToggle} />
          ))}
        </div>
      ))}
      {unassigned.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1 px-2.5">
            <span className="text-[10.5px] font-medium text-slate-400 uppercase tracking-wide">Без отдела</span>
          </div>
          {unassigned.map((p) => (
            <PersonCheckbox key={p.id} person={p} checked={selected.has(p.id)} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

const COLORS = ["#4F5DFF", "#2FB67C", "#E8A33D", "#E0567C"];

export default function CreateProjectModal({ onClose, onCreated, currentUser, projectCount }) {
  const [departments, setDepartments] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [stakeholderIds, setStakeholderIds] = useState(new Set());
  const [participantIds, setParticipantIds] = useState(new Set());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.getTeam().then(({ departments, unassigned }) => {
      setDepartments(
        departments.map((d) => ({ ...d, members: d.members.filter((m) => m.id !== currentUser.id) }))
      );
      setUnassigned(unassigned.filter((m) => m.id !== currentUser.id));
    });
  }, [currentUser.id]);

  const toggle = (set, setSet) => (id) => {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClear = () => {
    setName("");
    setDescription("");
    setStakeholderIds(new Set());
    setParticipantIds(new Set());
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const project = await api.createProject({
        name,
        description: description || undefined,
        color: COLORS[projectCount % COLORS.length],
        stakeholderIds: [...stakeholderIds],
        participantIds: [...participantIds],
      });
      onCreated(project);
    } catch (err) {
      setError(err.body?.error || "Не удалось создать проект");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center px-4 z-50">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold text-slate-900">Новый проект</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="text-[12px] font-medium text-slate-500 mb-1 block">Название проекта</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="Запуск нового продукта"
            />
          </div>

          <div>
            <label className="text-[12px] font-medium text-slate-500 mb-1 block">Заинтересованные лица</label>
            <PeoplePicker
              groups={departments}
              unassigned={unassigned}
              selected={stakeholderIds}
              onToggle={toggle(stakeholderIds, setStakeholderIds)}
            />
          </div>

          <div>
            <label className="text-[12px] font-medium text-slate-500 mb-1 block">Участники</label>
            <PeoplePicker
              groups={departments}
              unassigned={unassigned}
              selected={participantIds}
              onToggle={toggle(participantIds, setParticipantIds)}
            />
          </div>

          <div>
            <label className="text-[12px] font-medium text-slate-500 mb-1 block">Описание</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
              placeholder="О чём этот проект"
            />
          </div>

          {error && (
            <p className="text-[12.5px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleClear}
              className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-[13.5px] font-medium hover:bg-slate-50 transition-colors"
            >
              Очистить
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2.5 rounded-lg bg-[#4F5DFF] text-white text-[13.5px] font-medium hover:bg-[#4350DB] transition-colors disabled:opacity-60"
            >
              {submitting ? "Создаём…" : "Создать проект"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
