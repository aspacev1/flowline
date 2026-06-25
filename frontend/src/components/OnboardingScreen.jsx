import React, { useEffect, useState } from "react";
import { FolderKanban } from "lucide-react";
import { api } from "../api.js";

export default function OnboardingScreen({ inviteToken, onComplete }) {
  const [fullName, setFullName] = useState("");
  const [position, setPosition] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [organizationName, setOrganizationName] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inviteInvalid, setInviteInvalid] = useState(false);
  const [inviteCheckFailed, setInviteCheckFailed] = useState(false);
  const [checkingInvite, setCheckingInvite] = useState(false);

  const checkInvite = async () => {
    if (!inviteToken) return;
    setError(null);
    setInviteCheckFailed(false);
    setCheckingInvite(true);
    try {
      const invite = await api.resolveInvite(inviteToken);
      setOrganizationName(invite.organizationName);
    } catch (err) {
      if (err.status === 404) {
        // ссылка реально недействительна/истекла — нет смысла повторять
        setInviteInvalid(true);
        setError(err.body?.error || "Ссылка-приглашение недействительна или устарела");
      } else {
        // временная ошибка (сеть и т.п.) — не блокируем навсегда, даём повторить
        setInviteCheckFailed(true);
        setError("Не удалось проверить ссылку-приглашение. Проверьте соединение и попробуйте снова.");
      }
    } finally {
      setCheckingInvite(false);
    }
  };

  useEffect(() => {
    checkInvite();
  }, [inviteToken]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.submitOnboarding({
        fullName,
        position,
        companyName: inviteToken ? undefined : companyName,
        inviteToken,
      });
      onComplete(result);
    } catch (err) {
      setError(err.body?.error || "Что-то пошло не так");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-9 h-9 rounded-lg bg-[#4F5DFF] flex items-center justify-center">
            <FolderKanban size={19} className="text-white" />
          </div>
          <span className="text-slate-900 font-semibold text-[19px] tracking-tight">Flowline</span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h1 className="text-[16px] font-semibold text-slate-900 mb-1">Расскажите о себе</h1>
          {inviteToken && organizationName && (
            <p className="text-[13px] text-slate-500 mb-4">
              Вы присоединяетесь к организации <span className="font-medium text-slate-700">{organizationName}</span>
            </p>
          )}
          {!inviteToken && (
            <p className="text-[13px] text-slate-500 mb-4">Заполните несколько полей, чтобы продолжить</p>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="text-[12px] font-medium text-slate-500 mb-1 block">Полное имя</label>
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Анна Иванова"
              />
            </div>

            <div>
              <label className="text-[12px] font-medium text-slate-500 mb-1 block">Должность</label>
              <input
                required
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Менеджер проекта"
              />
            </div>

            {!inviteToken && (
              <div>
                <label className="text-[12px] font-medium text-slate-500 mb-1 block">Название компании</label>
                <input
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="Моя команда"
                />
              </div>
            )}

            {error && (
              <p className="text-[12.5px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            {inviteCheckFailed && (
              <button
                type="button"
                onClick={checkInvite}
                disabled={checkingInvite}
                className="text-[12.5px] text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-60"
              >
                {checkingInvite ? "Проверяем…" : "Повторить попытку"}
              </button>
            )}

            <button
              type="submit"
              disabled={loading || inviteInvalid}
              className="w-full py-2.5 rounded-lg bg-[#4F5DFF] text-white text-[14px] font-medium hover:bg-[#4350DB] transition-colors disabled:opacity-60"
            >
              {loading ? "Подождите…" : "Продолжить"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
