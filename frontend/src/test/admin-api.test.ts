import { afterEach, describe, expect, it, vi } from "vitest";

import { adminApi, setAdminCsrf } from "@/lib/admin-api";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Admin API contract", () => {
  afterEach(() => {
    setAdminCsrf("");
    vi.unstubAllGlobals();
  });

  it("uses the same-origin admin route and includes credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ pending2fa: true, requires2faSetup: false }));
    vi.stubGlobal("fetch", fetchMock);

    await adminApi.login("admin@example.com", "secret-password");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/admin/auth/login");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
    });
  });

  it("stores the session CSRF token and sends it on mutations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          admin: { id: "admin-1", email: "admin@example.com", role: "super" },
          csrfToken: "csrf-token-1",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ freeze_posting: true }));
    vi.stubGlobal("fetch", fetchMock);

    await adminApi.me();
    await adminApi.updateSettings({ freeze_posting: true, reason: "Emergency pause" });

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("x-csrf-token")).toBe("csrf-token-1");
    expect(JSON.parse(String(init.body))).toEqual({
      freeze_posting: true,
      reason: "Emergency pause",
    });
  });
});
