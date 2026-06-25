import React, { useState, useEffect } from "react";
import { FolderKanban } from "lucide-react";
import { api } from "../api.js";

const OAUTH_LABELS = {
  google: "Войти через Google",
  microsoft: "Войти через Microsoft",
  apple: "Войти через Apple",
};

export default function AuthScreen({ onAuthenticated }) {
  // Ссылки-приглашения ведут на /register?invite=... — открываем сразу вкладку регистрации
  const [mode, setMode] = useState(() =>
    new URLSearchParams(window.location.search).get("invite") ? "register" : "login"
  ); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [oauthProviders, setOauthProviders] = useState([]);

  useEffect(() => {
    api
      .getOAuthProviders()
      .then(({ providers }) => setOauthProviders(providers || []))
      .catch(() => setOauthProviders([]));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user =
        mode === "login"
          ? await api.login({ email, password })
          : await api.register({ email, password, fullName });
      onAuthenticated(user);
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
          {oauthProviders.length > 0 && (
            <div className="space-y-2 mb-5">
              {oauthProviders.map((provider) => (
                <button
                  key={provider}
                  type="button"
                  onClick={() => api.startOAuth(provider)}
                  className="w-full py-2.5 rounded-lg border border-slate-200 text-slate-700 text-[14px] font-medium hover:bg-slate-50 transition-colors"
                >
                  {OAUTH_LABELS[provider] || `Войти через ${provider}`}
                </button>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[12px] text-slate-400">или</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
            </div>
          )}

          <div className="flex mb-6 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 py-2 rounded-md text-[13.5px] font-medium transition-colors ${
                mode === "login" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Вход
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`flex-1 py-2 rounded-md text-[13.5px] font-medium transition-colors ${
                mode === "register" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Регистрация
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === "register" && (
              <div>
                <label className="text-[12px] font-medium text-slate-500 mb-1 block">Имя</label>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="Анна Иванова"
                />
              </div>
            )}

            <div>
              <label className="text-[12px] font-medium text-slate-500 mb-1 block">Почта</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="anna@demo.io"
              />
            </div>

            <div>
              <label className="text-[12px] font-medium text-slate-500 mb-1 block">Пароль</label>
              <input
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-[12.5px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-[#4F5DFF] text-white text-[14px] font-medium hover:bg-[#4350DB] transition-colors disabled:opacity-60"
            >
              {loading ? "Подождите…" : mode === "login" ? "Войти" : "Создать аккаунт"}
            </button>
          </form>
        </div>

        <p className="text-center text-[12px] text-slate-400 mt-5">
          Демо: anna@demo.io / demo1234
        </p>
      </div>
    </div>
  );
}
