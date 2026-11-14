import type { CategoryId, CommentType, Incident, IncidentComment } from "./incidents";

const configuredBase = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.trim();
export const API_BASE_URL = configuredBase?.replace(/\/$/, "") ?? "";
const API_V1 = "/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly fieldErrors?: Record<string, string>,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiCounts {
  support: number;
  dispute: number;
  flags: number;
  comments: number;
}

interface ApiIncident {
  trackingId: string;
  title: string;
  description: string;
  excerpt?: string;
  category: CategoryId;
  incidentAt: string;
  createdAt: string;
  location: { lat: number; lng: number };
  roadName: string | null;
  areaName: string | null;
  upazila: string | null;
  district: string | null;
  safetyTip: string | null;
  isEdited: boolean;
  editedAt: string | null;
  moderatedEdit: boolean;
  source: "public" | "team";
  counts: ApiCounts;
  my: { vote: "support" | "dispute" | null; flagged: boolean };
  distanceKm?: number;
}

interface ApiComment {
  id: string;
  type: CommentType;
  body: string | null;
  placeholder: boolean;
  redacted: boolean;
  createdAt: string;
  mine: boolean;
}

function incidentFromApi(value: ApiIncident): Incident {
  return {
    id: value.trackingId.toLowerCase(),
    trackingId: value.trackingId,
    title: value.title,
    description: value.description,
    category: value.category,
    lat: value.location.lat,
    lng: value.location.lng,
    roadName: value.roadName ?? "",
    areaName: value.areaName ?? value.upazila ?? value.district ?? "",
    incidentAt: Date.parse(value.incidentAt),
    createdAt: Date.parse(value.createdAt),
    ...(value.safetyTip ? { safetyTip: value.safetyTip } : {}),
    support: value.counts.support,
    dispute: value.counts.dispute,
    flags: value.counts.flags,
    commentCount: value.counts.comments,
    isEdited: value.isEdited,
    ...(value.editedAt ? { editedAt: Date.parse(value.editedAt) } : {}),
    byModerator: value.source === "team" || value.moderatedEdit,
    viewerState: { vote: value.my.vote, hasFlagged: value.my.flagged },
  };
}

function commentFromApi(value: ApiComment, trackingId: string): IncidentComment {
  return {
    id: value.id,
    incidentId: trackingId.toLowerCase(),
    type: value.type,
    text: value.body ?? "[মডারেটর কর্তৃক সরানো হয়েছে]",
    createdAt: Date.parse(value.createdAt),
    mine: value.mine,
    canDelete: value.mine && !value.placeholder,
    hasFlagged: false,
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${API_V1}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Backend-এর সঙ্গে সংযোগ করা যাচ্ছে না।", 0);
  }

  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as {
    error?: {
      code?: string;
      message?: string;
      fieldErrors?: Record<string, string>;
      details?: Record<string, unknown>;
    };
  } | null;
  if (!response.ok) {
    const error = data?.error;
    throw new ApiError(
      error?.code ?? "HTTP_ERROR",
      error?.message ?? "অনুরোধটি সম্পন্ন করা যায়নি।",
      response.status,
      error?.fieldErrors,
      error?.details,
    );
  }
  return data as T;
}

function query(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export interface IncidentListParams {
  q?: string;
  category?: CategoryId;
  from?: string;
  to?: string;
  district?: string;
  sort?: "newest" | "oldest" | "nearest";
  limit?: number;
  cursor?: string;
  bbox?: string;
  near?: string;
  radiusKm?: number;
}

export interface IncidentListResult {
  items: Incident[];
  nextCursor: string | null;
  truncated: boolean;
}

export interface TrackResult {
  incident: Incident;
  status: "published" | "hidden" | "deleted";
  versions: Array<{
    version: number;
    title: string;
    description: string;
    safetyTip?: string;
    savedAt: number;
  }>;
  edit: { allowed: boolean; deadline: number; remainingSeconds: number; editsLeft: number };
}

interface ApiTrackResult {
  incident: ApiIncident;
  status: TrackResult["status"];
  versions: Array<{
    version: number;
    title: string;
    description: string;
    safetyTip: string | null;
    editedAt: string;
  }>;
  edit: { allowed: boolean; remainingSeconds: number; editsLeft: number };
}

function trackFromApi(result: ApiTrackResult): TrackResult {
  return {
    ...result,
    incident: incidentFromApi(result.incident),
    versions: result.versions.map((version) => ({
      version: version.version,
      title: version.title,
      description: version.description,
      ...(version.safetyTip ? { safetyTip: version.safetyTip } : {}),
      savedAt: Date.parse(version.editedAt),
    })),
    edit: { ...result.edit, deadline: Date.now() + result.edit.remainingSeconds * 1000 },
  };
}

export const api = {
  async listIncidents(params: IncidentListParams = {}): Promise<IncidentListResult> {
    const result = await request<{
      items: ApiIncident[];
      nextCursor: string | null;
      truncated: boolean;
    }>(`/incidents${query({ ...params })}`);
    return { ...result, items: result.items.map(incidentFromApi) };
  },

  async getIncident(trackingId: string) {
    const result = await request<ApiIncident>(
      `/incidents/${encodeURIComponent(trackingId.toUpperCase())}`,
    );
    return incidentFromApi(result);
  },

  async createIncident(input: {
    title: string;
    description: string;
    category: CategoryId;
    incidentAt: string;
    lat: number;
    lng: number;
    roadName: string;
    areaName: string;
    safetyTip?: string;
    captchaToken: string;
  }) {
    const { lat, lng, ...fields } = input;
    const result = await request<{
      incident: ApiIncident;
      credentials: { trackingId: string; secret: string };
    }>("/incidents", {
      method: "POST",
      body: JSON.stringify({ ...fields, location: { lat, lng } }),
    });
    return { ...result, incident: incidentFromApi(result.incident) };
  },

  setVote(trackingId: string, type: "support" | "dispute") {
    return request(`/incidents/${encodeURIComponent(trackingId)}/vote`, {
      method: "POST",
      body: JSON.stringify({ type }),
    });
  },

  removeVote(trackingId: string) {
    return request(`/incidents/${encodeURIComponent(trackingId)}/vote`, { method: "DELETE" });
  },

  reportIncident(trackingId: string, reason: string) {
    return request(`/incidents/${encodeURIComponent(trackingId)}/reports`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },

  async listComments(trackingId: string, limit = 50, cursor?: string) {
    const result = await request<{ items: ApiComment[]; nextCursor: string | null }>(
      `/incidents/${encodeURIComponent(trackingId)}/comments${query({ limit, cursor })}`,
    );
    return { ...result, items: result.items.map((comment) => commentFromApi(comment, trackingId)) };
  },

  async createComment(
    trackingId: string,
    input: { type: CommentType; text: string; captchaToken: string },
  ) {
    const result = await request<{
      comment: ApiComment;
      quota: { commentsLeft: number; resetsAt: string };
    }>(`/incidents/${encodeURIComponent(trackingId)}/comments`, {
      method: "POST",
      body: JSON.stringify({
        type: input.type,
        body: input.text,
        captchaToken: input.captchaToken,
      }),
    });
    return {
      comment: commentFromApi(result.comment, trackingId),
      quota: {
        limit: 5,
        used: Math.max(0, 5 - result.quota.commentsLeft),
        remaining: result.quota.commentsLeft,
        resetsAt: result.quota.resetsAt,
      },
    };
  },

  deleteComment(commentId: string) {
    return request(`/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
  },

  reportComment(commentId: string, reason: string) {
    return request(`/comments/${encodeURIComponent(commentId)}/reports`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },

  async track(trackingId: string, secret: string): Promise<TrackResult> {
    const result = await request<ApiTrackResult>("/track", {
      method: "POST",
      body: JSON.stringify({ trackingId, secret }),
    });
    return trackFromApi(result);
  },

  async editIncident(
    trackingId: string,
    input: { secret: string; title: string; description: string; safetyTip?: string },
  ) {
    const result = await request<ApiTrackResult>(`/incidents/${encodeURIComponent(trackingId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    return trackFromApi(result);
  },

  async reverseGeocode(lat: number, lng: number) {
    const result = await request<{
      fallback?: boolean;
      roadName?: string;
      areaName?: string;
      district?: string;
    }>(`/geo/reverse${query({ lat, lng })}`);
    return {
      location: {
        roadName: result.roadName ?? "",
        areaName: result.areaName ?? result.district ?? "",
      },
      fallback: Boolean(result.fallback),
    };
  },
};

export function apiMessage(error: unknown) {
  return error instanceof ApiError ? error.message : "অনুরোধটি সম্পন্ন করা যায়নি।";
}
