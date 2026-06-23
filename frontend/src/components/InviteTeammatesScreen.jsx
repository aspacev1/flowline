import React, { useEffect, useState } from "react";
import { FolderKanban } from "lucide-react";
import { api } from "../api.js";

export default function InviteTeammatesScreen({ onDone }) {
  const [tab, setTab] = useState("link"); // "link" | "email"

  const [linkUrl, setLinkUrl] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState(null);
  const [linkLoaded, setLinkLoaded] = useState(false);

  const [emailsText, setEmailsText] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const [emailResult, setEmailResult] = useState(null);

  useEffect(() => {
    if (tab !== "link" || linkLoaded) return;
    (async () => {
      setLinkError(null);
      try {
        const { url } = await api.getInviteLink();
        setLinkUrl(url);
      } catch (err) {
        setLinkError(err.body?.error || "Не удалось получить ссылку-приглашение");
      } finally {
        setLinkLoaded(true);
      }
    })();
  }, [tab, linkLoaded]);

  const handleRegenerate = async () => {
    setLinkError(null);
    setLinkLoading(true);
    try {
      const { url } = await api.regenerateInviteLink();
      setLinkUrl(url);
    } catch (err) {
      setLinkError(err.body?.error || "Не удалось обновить ссылку-приглашение");
    } finally {
      setLinkLoading(false);
    }
  };

  const handleInviteByEmail = async (e) => {
    e.preventDefault();
    setEmailError(null);
    setEmailResult(null);
    const emails = emailsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (emails.length === 0) {
      setEmailError("Укажите хотя бы один email");
      return;
    }

    setEmailLoading(true);
    try {
      const result = await api.inviteByEmail(emails);
      setEmailResult(result);
    } catch (err) {
      setEmailError(err.body?.error || "Не удалось отправить приглашения");
    } finally {
      setEmailLoading(false);
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
          <h1 className="text-[16px] font-semibold text-slate-900 mb-1">Пригласите команду</h1>
          <p className="text-[13px] text-slate-500 mb-4">Это можно сделать позже из настроек</p>

          <div className="flex mb-6 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setTab("link")}
              className={`flex-1 py-2 rounded-md text-[13.5px] font-medium transition-colors ${
                tab === "link" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Ссылка
            </button>
            <button
              type="button"
              onClick={() => setTab("email")}
              className={`flex-1 py-2 rounded-md text-[13.5px] font-medium transition-colors ${
                tab === "email" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              По email
            </button>
          </div>

          {tab === "link" && (
            <div className="space-y-3.5">
              <div>
                <label className="text-[12px] font-medium text-slate-500 mb-1 block">
                  Ссылка-приглашение
                </label>
                <input
                  readOnly
                  value={linkUrl}
                  onFocus={(e) => e.target.select()}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[14px] bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="Загрузка…"
                />
              </div>

              {linkError && (
                <p className="text-[12.5px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {linkError}
                </p>
              )}

              <button
                type="button"
                onClick={handleRegenerate}
                disabled={linkLoading}
                className="w-full py-2.5 rounded-lg bg-[#4F5DFF] text-white text-[14px] font-medium hover:bg-[#4350DB] transition-colors disabled:opacity-60"
              >
                {linkLoading ? "Подождите…" : "Сгенерировать новую ссылку"}
              </button>
            </div>
          )}

          {tab === "email" && (
            <form onSubmit={handleInviteByEmail} className="space-y-3.5">
              <div>
                <label className="text-[12px] font-medium text-slate-500 mb-1 block">
                  Email коллег
                </label>
                <textarea
                  value={emailsText}
                  onChange={(e) => setEmailsText(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="anna@demo.io, ivan@demo.io"
                />
              </div>

              {emailError && (
                <p className="text-[12.5px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {emailError}
                </p>
              )}

              {emailResult && (
                <div className="text-[12.5px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 space-y-1">
                  <p>Отправлено приглашений: {emailResult.sent?.length ?? 0}</p>
                  {emailResult.failed?.length > 0 && (
                    <p>Не удалось отправить: {emailResult.failed.join(", ")}</p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={emailLoading}
                className="w-full py-2.5 rounded-lg bg-[#4F5DFF] text-white text-[14px] font-medium hover:bg-[#4350DB] transition-colors disabled:opacity-60"
              >
                {emailLoading ? "Подождите…" : "Отправить приглашения"}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={onDone}
            className="w-full text-center text-[13px] text-slate-400 hover:text-slate-600 transition-colors mt-5"
          >
            Пропустить
          </button>
        </div>
      </div>
    </div>
  );
}
