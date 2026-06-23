const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    const error = new Error(body?.message || body?.error || `Request failed: ${res.status}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

export const api = {
  // ---- auth ----
  register: (data) => request("/auth/register", { method: "POST", body: JSON.stringify(data) }),
  login: (data) => request("/auth/login", { method: "POST", body: JSON.stringify(data) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me"),

  // ---- onboarding / invites ----
  getOAuthProviders: () => request("/auth/oauth/providers"),
  startOAuth: (provider) => {
    const inviteToken = new URLSearchParams(window.location.search).get("invite");
    const url = inviteToken
      ? `${API_BASE}/auth/oauth/${provider}/start?invite=${encodeURIComponent(inviteToken)}`
      : `${API_BASE}/auth/oauth/${provider}/start`;
    window.location.href = url;
  },
  submitOnboarding: ({ fullName, position, companyName, inviteToken }) =>
    request("/auth/onboarding", {
      method: "POST",
      body: JSON.stringify({ fullName, position, companyName, inviteToken }),
    }),
  resolveInvite: (token) => request(`/invites/resolve/${token}`),
  getInviteLink: () => request("/invites/link"),
  regenerateInviteLink: () => request("/invites/link/regenerate", { method: "POST" }),
  inviteByEmail: (emails) =>
    request("/invites/emails", { method: "POST", body: JSON.stringify({ emails }) }),

  // ---- team ----
  getTeam: () => request("/team"),
  getPeople: () => request("/team/people"),

  // ---- projects ----
  getProjects: () => request("/projects"),
  createProject: (data) => request("/projects", { method: "POST", body: JSON.stringify(data) }),
  getProject: (id) => request(`/projects/${id}`),
  updateProject: (id, data) => request(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProject: (id) => request(`/projects/${id}`, { method: "DELETE" }),

  // ---- work items ----
  getWorkItems: (projectId) => request(`/projects/${projectId}/work-items`),
  createWorkItem: (projectId, data) =>
    request(`/projects/${projectId}/work-items`, { method: "POST", body: JSON.stringify(data) }),
  updateWorkItem: (id, patch, confirmedDelay = false) =>
    request(`/work-items/${id}`, { method: "PATCH", body: JSON.stringify({ patch, confirmedDelay }) }),
  deleteWorkItem: (id) => request(`/work-items/${id}`, { method: "DELETE" }),
  getWorkItemHistory: (id) => request(`/work-items/${id}/history`),
};

export class ScheduleDelayError extends Error {
  constructor(body) {
    super(body.message);
    this.originalEndDate = body.originalEndDate;
    this.newEndDate = body.newEndDate;
  }
}
