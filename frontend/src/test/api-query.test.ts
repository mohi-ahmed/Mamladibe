import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";

const apiIncident = {
  trackingId: "MD-7K3Q9XTB",
  title: "Large pothole beside the bus stop",
  description: "The pothole occupies most of the left lane near the bus stop.",
  category: "infrastructure" as const,
  incidentAt: "2026-11-11T14:30:00.000Z",
  createdAt: "2026-11-11T14:35:00.000Z",
  location: { lat: 23.7808, lng: 90.4093 },
  roadName: "Airport Road",
  areaName: "Banani",
  upazila: null,
  district: "Dhaka",
  safetyTip: null,
  isEdited: false,
  editedAt: null,
  moderatedEdit: false,
  source: "public" as const,
  counts: { support: 12, dispute: 3, flags: 1, comments: 4 },
  my: { vote: "support" as const, flagged: false },
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("API v1 contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses canonical cursor, category and bbox query parameters", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], nextCursor: null, truncated: false }));
    vi.stubGlobal("fetch", fetchMock);

    await api.listIncidents({
      q: "ফার্মগেট",
      category: "road_accident",
      from: "2026-11-01T00:00:00.000Z",
      bbox: "90.3,23.7,90.5,23.9",
      limit: 20,
      cursor: "next-page",
      sort: "newest",
    });

    // Same-origin deployments intentionally use a relative /api/v1 URL.
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
    expect(url.pathname).toBe("/api/v1/incidents");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "ফার্মগেট",
      category: "road_accident",
      from: "2026-11-01T00:00:00.000Z",
      bbox: "90.3,23.7,90.5,23.9",
      limit: "20",
      cursor: "next-page",
      sort: "newest",
    });
  });

  it("adapts nested backend incident fields to the UI model", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ items: [apiIncident], nextCursor: "cursor-2", truncated: false }),
        ),
    );

    const result = await api.listIncidents();
    expect(result.nextCursor).toBe("cursor-2");
    expect(result.items[0]).toMatchObject({
      id: "md-7k3q9xtb",
      category: "infrastructure",
      lat: 23.7808,
      lng: 90.4093,
      support: 12,
      dispute: 3,
      flags: 1,
      commentCount: 4,
      viewerState: { vote: "support", hasFlagged: false },
    });
  });

  it("creates incidents with a nested location object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          incident: apiIncident,
          credentials: { trackingId: apiIncident.trackingId, secret: "AAAAA-BBBBB-CCCCC-DDDDD-E" },
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.createIncident({
      title: apiIncident.title,
      description: apiIncident.description,
      category: "infrastructure",
      incidentAt: apiIncident.incidentAt,
      lat: 23.7808,
      lng: 90.4093,
      roadName: "Airport Road",
      areaName: "Banani",
      captchaToken: "captcha",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["location"]).toEqual({ lat: 23.7808, lng: 90.4093 });
    expect(body).not.toHaveProperty("lat");
    expect(body).not.toHaveProperty("lng");
  });

  it("uses backend comment fields and plural report routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            comment: {
              id: "6731a0c2f1d2a3b4c5d6e001",
              type: "info",
              body: "Additional information from the scene.",
              placeholder: false,
              redacted: false,
              createdAt: "2026-11-11T15:00:00.000Z",
              mine: true,
            },
            quota: { commentsLeft: 4, resetsAt: "2026-11-12T18:00:00.000Z" },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ reported: true }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const created = await api.createComment(apiIncident.trackingId, {
      type: "info",
      text: "Additional information from the scene.",
      captchaToken: "captcha",
    });
    await api.reportComment("6731a0c2f1d2a3b4c5d6e001", "spam");

    const createBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(createBody).toEqual({
      type: "info",
      body: "Additional information from the scene.",
      captchaToken: "captcha",
    });
    expect(created.quota.remaining).toBe(4);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/api/v1/comments/6731a0c2f1d2a3b4c5d6e001/reports",
    );
  });
});
