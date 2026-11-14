import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminConsole } from "@/components/admin/AdminConsole";

const apiMocks = vi.hoisted(() => ({
  me: vi.fn(),
  dashboard: vi.fn(),
  incidents: vi.fn(),
  comments: vi.fn(),
  reports: vi.fn(),
  actors: vi.fn(),
  audit: vi.fn(),
  users: vi.fn(),
  settings: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/lib/admin-api", () => ({ adminApi: apiMocks }));

const dashboard = {
  counts: {
    newIncidentsToday: 0,
    openFlags: 0,
    hiddenIncidents: 0,
    activeRestrictions: 0,
    commentsToday: 0,
  },
  recentAudit: [],
};

function prepare() {
  apiMocks.me.mockResolvedValue({
    admin: { id: "admin-1", email: "super@example.com", role: "super" },
    csrfToken: "csrf",
  });
  apiMocks.dashboard.mockResolvedValue(dashboard);
  apiMocks.users.mockResolvedValue({
    items: [
      {
        id: "1",
        email: "one@example.com",
        role: "super",
        totpEnabled: true,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastLoginAt: null,
      },
      {
        id: "2",
        email: "two@example.com",
        role: "moderator",
        totpEnabled: false,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastLoginAt: null,
      },
      {
        id: "3",
        email: "three@example.com",
        role: "moderator",
        totpEnabled: false,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastLoginAt: null,
      },
    ],
  });
}

describe("Admin console resilience", () => {
  afterEach(() => vi.clearAllMocks());

  it("keeps the flag badge tied to dashboard open flags, not the active page record count", async () => {
    prepare();
    render(<AdminConsole />);

    fireEvent.click(await screen.findByRole("button", { name: /Admin users/i }));
    await screen.findByText("three@example.com");

    expect(screen.getByRole("button", { name: /Flag reports/i })).toHaveTextContent("0");
    expect(screen.getByText(/Setup required.*enabled/i)).toBeInTheDocument();
  });

  it("renders an unknown status instead of crashing on an incomplete backend record", async () => {
    prepare();
    apiMocks.incidents.mockResolvedValue({
      items: [
        {
          id: "incident-1",
          trackingId: "MD-TEST",
          title: "Incomplete contract record",
          category: "other",
          source: "public",
          actorIdShort: null,
          areaName: "Dhaka",
          district: "Dhaka",
          createdAt: "2026-01-01T00:00:00.000Z",
          incidentAt: "2026-01-01T00:00:00.000Z",
          editCount: 0,
          moderatedEdit: false,
        },
      ],
      nextCursor: null,
    });
    render(<AdminConsole />);

    fireEvent.click(await screen.findByRole("button", { name: /Incidents/i }));

    await waitFor(() => expect(screen.getByText("unknown")).toBeInTheDocument());
    expect(screen.queryByText("This page didn't load")).not.toBeInTheDocument();
  });
});
