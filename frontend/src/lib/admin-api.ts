import { API_BASE_URL, ApiError } from "./api";

const ADMIN_ROOT = `${API_BASE_URL}/api/v1/admin`;

export type AdminRole = "super" | "moderator";
export type AdminIdentity = { id: string; email: string; role: AdminRole };
export type PageResult<T> = { items: T[]; nextCursor: string | null };

export interface AdminIncident {
  id: string;
  trackingId: string;
  title: string;
  excerpt: string;
  description?: string;
  category: string;
  status: string;
  source: string;
  actorIdShort: string | null;
  areaName: string | null;
  district: string | null;
  createdAt: string;
  incidentAt: string;
  editCount: number;
  moderatedEdit: boolean;
  location?: { lat: number; lng: number };
  roadName?: string | null;
  safetyTip?: string | null;
  counts?: Record<string, number>;
}
export interface AdminComment {
  id: string;
  incidentId: string;
  trackingId: string | null;
  actorIdShort: string;
  type: string;
  body: string | null;
  status: string;
  redacted: boolean;
  createdAt: string;
}
export interface AdminReport {
  id: string;
  targetType: string;
  targetId: string;
  actorIdShort: string;
  reason: string;
  note: string | null;
  status: string;
  resolutionNote: string | null;
  createdAt: string;
  totalFlagsOnTarget: number;
  targetPreview: Record<string, unknown> | null;
}
export interface AdminActor {
  id: string;
  actorIdShort: string;
  firstSeenAt: string;
  lastSeenAt: string;
  restriction: { scope: string; until: string; reason: string } | null;
  restrictionHistoryCount: number;
  notes: string | null;
}
export interface AuditItem {
  id: string;
  adminId: string;
  adminEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  createdAt: string;
  before?: unknown;
  after?: unknown;
}
export interface AdminUser {
  id: string;
  email: string;
  role: AdminRole;
  totpEnabled: boolean;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminCreateIncidentInput {
  title: string;
  description: string;
  category:
    | "road_accident"
    | "traffic_violation"
    | "police_misconduct"
    | "infrastructure"
    | "public_safety"
    | "other";
  incidentAt: string;
  location: { lat: number; lng: number };
  areaName?: string;
  district?: string;
  roadName?: string;
  reason: string;
}

export interface DashboardData {
  counts: {
    newIncidentsToday: number;
    openFlags: number;
    hiddenIncidents: number;
    activeRestrictions: number;
    commentsToday: number;
  };
  recentAudit: AuditItem[];
}

let csrfToken = "";
export function setAdminCsrf(value: string) {
  csrfToken = value;
}

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (csrfToken && init.method && init.method !== "GET") headers.set("x-csrf-token", csrfToken);
  let response: Response;
  try {
    response = await fetch(`${ADMIN_ROOT}${path}`, { ...init, headers, credentials: "include" });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Admin API-এর সঙ্গে সংযোগ করা যাচ্ছে না।", 0);
  }
  const payload = (await response.json().catch(() => null)) as {
    error?: {
      code?: string;
      message?: string;
      fieldErrors?: Record<string, string>;
      details?: Record<string, unknown>;
    };
  } | null;
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      error?.code ?? "HTTP_ERROR",
      error?.message ?? "Admin request সম্পন্ন করা যায়নি।",
      response.status,
      error?.fieldErrors,
      error?.details,
    );
  }
  return payload as T;
}

function qs(values: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const adminApi = {
  login: (email: string, password: string) =>
    adminRequest<{
      pending2fa: true;
      requires2faSetup: boolean;
      totpSetup?: { qrDataUrl: string; manualKey: string };
    }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  verify2fa: async (code: string) => {
    const value = await adminRequest<{ admin: AdminIdentity; csrfToken: string }>(
      "/auth/verify-2fa",
      { method: "POST", body: JSON.stringify({ code }) },
    );
    setAdminCsrf(value.csrfToken);
    return value;
  },
  me: async () => {
    const value = await adminRequest<{ admin: AdminIdentity; csrfToken: string }>("/auth/me");
    setAdminCsrf(value.csrfToken);
    return value;
  },
  logout: async () => {
    const value = await adminRequest<{ loggedOut: boolean }>("/auth/logout", { method: "POST" });
    setAdminCsrf("");
    return value;
  },
  dashboard: () => adminRequest<DashboardData>("/dashboard"),
  createIncident: (body: AdminCreateIncidentInput) =>
    adminRequest<{ incident: AdminIncident }>("/incidents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  incidents: (params: Record<string, string | number | undefined> = {}) =>
    adminRequest<PageResult<AdminIncident>>(`/incidents${qs(params)}`),
  incident: (id: string) =>
    adminRequest<{
      incident: AdminIncident;
      versions: unknown[];
      comments: unknown[];
      flags: unknown[];
      auditHistory: AuditItem[];
    }>(`/incidents/${encodeURIComponent(id)}`),
  incidentAction: (
    id: string,
    action: "hide" | "unhide" | "restore" | "delete" | "permanent",
    reason: string,
  ) =>
    adminRequest(
      action === "delete" || action === "permanent"
        ? `/incidents/${encodeURIComponent(id)}${action === "permanent" ? "/permanent" : ""}`
        : `/incidents/${encodeURIComponent(id)}/${action}`,
      {
        method: action === "delete" || action === "permanent" ? "DELETE" : "POST",
        body: JSON.stringify({ reason }),
      },
    ),
  editIncident: (id: string, body: Record<string, unknown>) =>
    adminRequest(`/incidents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  comments: (params: Record<string, string | number | undefined> = {}) =>
    adminRequest<PageResult<AdminComment>>(`/comments${qs(params)}`),
  comment: (id: string) =>
    adminRequest<{
      comment: AdminComment;
      incident: unknown;
      flags: unknown[];
      auditHistory: AuditItem[];
    }>(`/comments/${id}`),
  commentAction: (id: string, action: "hide" | "unhide" | "delete" | "permanent", reason: string) =>
    adminRequest(
      action === "delete" || action === "permanent"
        ? `/comments/${id}${action === "permanent" ? "/permanent" : ""}`
        : `/comments/${id}/${action}`,
      {
        method: action === "delete" || action === "permanent" ? "DELETE" : "POST",
        body: JSON.stringify({ reason }),
      },
    ),
  editComment: (id: string, body: string, reason: string) =>
    adminRequest(`/comments/${id}`, { method: "PATCH", body: JSON.stringify({ body, reason }) }),
  reports: (params: Record<string, string | number | undefined> = {}) =>
    adminRequest<PageResult<AdminReport>>(`/reports${qs(params)}`),
  report: (id: string) => adminRequest<Record<string, unknown>>(`/reports/${id}`),
  resolveReport: (id: string, outcome: "actioned" | "dismissed", note: string) =>
    adminRequest(`/reports/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ outcome, note, resolveAllForTarget: true }),
    }),
  actors: (params: Record<string, string | number | boolean | undefined> = {}) =>
    adminRequest<PageResult<AdminActor>>(`/actors${qs(params)}`),
  actor: (id: string) => adminRequest<Record<string, unknown>>(`/actors/${encodeURIComponent(id)}`),
  restrictActor: (id: string, scope: string, until: string, reason: string) =>
    adminRequest(`/actors/${id}/restrict`, {
      method: "POST",
      body: JSON.stringify({ scope, until, reason }),
    }),
  unrestrictActor: (id: string, reason: string) =>
    adminRequest(`/actors/${id}/unrestrict`, { method: "POST", body: JSON.stringify({ reason }) }),
  audit: (params: Record<string, string | number | undefined> = {}) =>
    adminRequest<PageResult<AuditItem>>(`/audit${qs(params)}`),
  users: () => adminRequest<{ items: AdminUser[] }>("/users"),
  createUser: (email: string, password: string, role: AdminRole, reason: string) =>
    adminRequest<{ user: AdminUser }>("/users", {
      method: "POST",
      body: JSON.stringify({ email, password, role, reason }),
    }),
  reset2fa: (id: string, reason: string) =>
    adminRequest(`/users/${id}/reset-2fa`, { method: "POST", body: JSON.stringify({ reason }) }),
  settings: () =>
    adminRequest<{
      freeze_posting: boolean;
      freeze_comments: boolean;
      updatedAt: Record<string, string | null>;
    }>("/settings"),
  updateSettings: (body: { freeze_posting?: boolean; freeze_comments?: boolean; reason: string }) =>
    adminRequest("/settings", { method: "PATCH", body: JSON.stringify(body) }),
};
