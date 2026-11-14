import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type IncidentListParams } from "./api";
import type { Incident } from "./incidents";

export const incidentKeys = {
  all: ["incidents"] as const,
  list: (params: IncidentListParams) => ["incidents", "list", params] as const,
  detail: (trackingId: string) => ["incidents", "detail", trackingId.toUpperCase()] as const,
  comments: (trackingId: string) => ["incidents", "comments", trackingId.toUpperCase()] as const,
};

/** Public feed used by the home and map screens. */
export function useIncidents() {
  const result = useQuery({
    queryKey: incidentKeys.list({ limit: 20, sort: "newest" }),
    queryFn: () => api.listIncidents({ limit: 20, sort: "newest" }),
  });
  return result.data?.items ?? [];
}

export function useIncidentList(params: IncidentListParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: incidentKeys.list(params),
    queryFn: () => api.listIncidents(params),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

export function useIncident(id: string) {
  const trackingId = id.toUpperCase();
  const result = useQuery({
    queryKey: incidentKeys.detail(trackingId),
    queryFn: () => api.getIncident(trackingId),
    enabled: Boolean(id),
  });
  return result.data;
}

export function useIncidentQuery(id: string) {
  const trackingId = id.toUpperCase();
  return useQuery({
    queryKey: incidentKeys.detail(trackingId),
    queryFn: () => api.getIncident(trackingId),
    enabled: Boolean(id),
  });
}

export function useMyVote(id: string) {
  return useIncident(id)?.viewerState.vote ?? undefined;
}

export function useComments(id: string) {
  const trackingId = id.toUpperCase();
  const result = useQuery({
    queryKey: incidentKeys.comments(trackingId),
    queryFn: () => api.listComments(trackingId),
    enabled: Boolean(id),
  });
  return result.data?.items ?? [];
}

export function useRefreshIncident() {
  const client = useQueryClient();
  return async (trackingId: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: incidentKeys.all }),
      client.invalidateQueries({ queryKey: incidentKeys.detail(trackingId) }),
      client.invalidateQueries({ queryKey: incidentKeys.comments(trackingId) }),
    ]);
  };
}

export async function castVote(incident: Incident, vote: "support" | "dispute") {
  if (incident.viewerState.vote === vote) return api.removeVote(incident.trackingId);
  return api.setVote(incident.trackingId, vote);
}

export const flagIncident = (trackingId: string, reason: string) =>
  api.reportIncident(trackingId, reason);

export const addComment = (
  trackingId: string,
  comment: { type: "info" | "correction" | "experience"; text: string; captchaToken: string },
) => api.createComment(trackingId, comment);

export const deleteComment = (commentId: string) => api.deleteComment(commentId);
export const flagComment = (commentId: string, reason: string) =>
  api.reportComment(commentId, reason);
