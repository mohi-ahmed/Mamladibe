import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiProxyErrorResponse,
  isApiProxyRequest,
  parseApiUpstreamOrigin,
  proxyApiRequest,
} from "@/lib/api-proxy";

describe("same-origin API proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("matches only the /api/v1 namespace", () => {
    expect(isApiProxyRequest(new Request("https://app.example/api/v1/health"))).toBe(true);
    expect(isApiProxyRequest(new Request("https://app.example/api/v10/health"))).toBe(false);
    expect(isApiProxyRequest(new Request("https://app.example/incidents"))).toBe(false);
  });

  it("requires an HTTPS origin without a path in production", () => {
    expect(parseApiUpstreamOrigin("https://api.example.com/", "production")).toBe(
      "https://api.example.com",
    );
    expect(() => parseApiUpstreamOrigin("http://api.example.com", "production")).toThrow(/HTTPS/);
    expect(() => parseApiUpstreamOrigin("https://api.example.com/api", "production")).toThrow(
      /without a path/,
    );
  });

  it("forwards path, query, origin, cookies and request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: {
          "content-type": "application/json",
          "set-cookie": "mdb_actor=token; HttpOnly; Secure; SameSite=Lax; Path=/",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyApiRequest(
      new Request("https://app.example/api/v1/incidents?limit=20", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "mdb_actor=existing",
          origin: "https://app.example",
        },
        body: JSON.stringify({ title: "test" }),
      }),
      "https://api.example.com",
    );

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.example.com/api/v1/incidents?limit=20");
    expect(new Headers(init.headers).get("origin")).toBe("https://app.example");
    expect(new Headers(init.headers).get("cookie")).toBe("mdb_actor=existing");
    expect(new Headers(init.headers).get("x-forwarded-host")).toBe("app.example");
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"title":"test"}');
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("mdb_actor=token");
  });

  it("returns a safe no-store configuration error", async () => {
    const response = apiProxyErrorResponse(new Error("MAMLADIBE_API_ORIGIN is not configured."));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "API_PROXY_NOT_CONFIGURED" },
    });
  });
});
