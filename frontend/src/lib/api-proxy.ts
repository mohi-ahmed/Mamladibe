const API_PREFIX = "/api/v1";

export function isApiProxyRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

export function parseApiUpstreamOrigin(
  rawValue: string | undefined,
  nodeEnv = process.env["NODE_ENV"],
): string {
  const raw = rawValue?.trim();
  if (!raw) {
    throw new Error("MAMLADIBE_API_ORIGIN is not configured.");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MAMLADIBE_API_ORIGIN must be a valid HTTP(S) origin.");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("MAMLADIBE_API_ORIGIN must contain only an HTTP(S) origin without a path.");
  }
  if (nodeEnv === "production" && url.protocol !== "https:") {
    throw new Error("MAMLADIBE_API_ORIGIN must use HTTPS in production.");
  }

  return url.origin;
}

function createUpstreamHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");

  const publicUrl = new URL(request.url);
  headers.set("x-forwarded-host", publicUrl.host);
  headers.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));
  return headers;
}

function createDownstreamHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const [name, value] of upstream.headers) {
    const normalized = name.toLowerCase();
    if (
      normalized === "set-cookie" ||
      normalized === "content-encoding" ||
      normalized === "content-length" ||
      normalized === "transfer-encoding" ||
      normalized === "connection"
    ) {
      continue;
    }
    headers.append(name, value);
  }

  const cookieHeaders = upstream.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = cookieHeaders.getSetCookie?.();
  if (setCookies?.length) {
    for (const cookie of setCookies) headers.append("set-cookie", cookie);
  } else {
    const cookie = upstream.headers.get("set-cookie");
    if (cookie) headers.set("set-cookie", cookie);
  }
  return headers;
}

export async function proxyApiRequest(
  request: Request,
  configuredOrigin = process.env["MAMLADIBE_API_ORIGIN"],
): Promise<Response> {
  if (!isApiProxyRequest(request)) {
    throw new Error("Only /api/v1 requests can be proxied.");
  }

  const upstreamOrigin = parseApiUpstreamOrigin(configuredOrigin);
  const publicUrl = new URL(request.url);
  const upstreamUrl = new URL(`${publicUrl.pathname}${publicUrl.search}`, upstreamOrigin);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers: createUpstreamHeaders(request),
    ...(hasBody ? { body: await request.arrayBuffer() } : {}),
    redirect: "manual",
    signal: request.signal,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: createDownstreamHeaders(upstream),
  });
}

export function apiProxyErrorResponse(error: unknown): Response {
  const configurationError =
    error instanceof Error && error.message.startsWith("MAMLADIBE_API_ORIGIN");
  return Response.json(
    {
      error: {
        code: configurationError ? "API_PROXY_NOT_CONFIGURED" : "API_UPSTREAM_UNAVAILABLE",
        message: configurationError
          ? "The API proxy is not configured."
          : "The API service is temporarily unavailable.",
      },
    },
    {
      status: configurationError ? 503 : 502,
      headers: { "cache-control": "no-store" },
    },
  );
}
