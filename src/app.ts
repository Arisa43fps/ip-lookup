import { isIP } from "./lib/ip";

const IPINFO_ENDPOINT = "https://api.ipinfo.io/lite";
const UPSTREAM_TIMEOUT_MS = 5_000;

const STATIC_SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
};

export interface IpInfoLite {
  ip: string;
  asn?: string;
  as_name?: string;
  as_domain?: string;
  country_code?: string;
  country?: string;
  continent_code?: string;
  continent?: string;
  bogon?: boolean;
  anycast?: boolean;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function handleRequest(
  request: Request,
  env: Env,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/ip") {
    return handleLookup(request, url, env, fetchImpl);
  }

  if (url.pathname.startsWith("/api/")) {
    return json({ error: "Not found." }, 404);
  }

  return serveAsset(request, env);
}

async function handleLookup(
  request: Request,
  url: URL,
  env: Env,
  fetchImpl: FetchLike,
): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
  }

  const explicitIp = url.searchParams.get("ip")?.trim() ?? "";
  const ip = explicitIp || clientIp(request);

  if (!ip) {
    return json(
      { error: "Could not determine your IP address. Enter an IP address to look up." },
      400,
    );
  }

  if (!isIP(ip)) {
    return json({ error: "Enter a valid IPv4 or IPv6 address." }, 400);
  }

  if (!env.IPINFO_TOKEN) {
    return json(
      { error: "IPinfo is not configured. Add the IPINFO_TOKEN secret." },
      500,
    );
  }

  const upstream = new URL(`${IPINFO_ENDPOINT}/${ip}`);
  upstream.searchParams.set("token", env.IPINFO_TOKEN);

  let response: Response;
  try {
    response = await fetchImpl(upstream, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Never log the caught error: the upstream URL contains the token.
    return json({ error: "Could not reach IPinfo. Try again in a moment." }, 502);
  }

  if (response.status === 404) {
    return json({ error: "No information was found for that IP address." }, 404);
  }

  if (response.status === 401 || response.status === 403) {
    console.error("IPinfo rejected the configured token.");
    return json({ error: "IPinfo rejected the configured token." }, 502);
  }

  if (!response.ok) {
    console.error(`IPinfo returned HTTP ${response.status}.`);
    return json({ error: "IPinfo lookup failed. Try again in a moment." }, 502);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return json({ error: "IPinfo returned an invalid response." }, 502);
  }

  if (!isIpInfoLite(data)) {
    return json({ error: "IPinfo returned an unexpected response." }, 502);
  }

  return json(data, 200, {
    "Cache-Control": explicitIp ? "public, max-age=300" : "no-store",
  });
}

function clientIp(request: Request): string | null {
  const direct = request.headers.get("CF-Connecting-IP");
  if (direct) return stripBrackets(direct);

  // Local `wrangler dev` may not set CF-Connecting-IP. In production Cloudflare
  // sets the header above, so this is only a development fallback.
  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded) return stripBrackets(forwarded.split(",")[0] ?? "");

  return null;
}

function stripBrackets(value: string): string {
  return value.trim().replace(/^\[|\]$/g, "");
}

function isIpInfoLite(value: unknown): value is IpInfoLite {
  if (typeof value !== "object" || value === null) return false;
  const ip = (value as { ip?: unknown }).ip;
  return typeof ip === "string" && ip.length > 0;
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

async function serveAsset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
