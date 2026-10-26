import { isHostname } from "./lib/host";
import { isIP } from "./lib/ip";

const IPINFO_ENDPOINT = "https://api.ipinfo.io/lite";
const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
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

  if (!env.IPINFO_TOKEN) {
    return json(
      { error: "IPinfo is not configured. Add the IPINFO_TOKEN secret." },
      500,
    );
  }

  const query = url.searchParams.get("ip")?.trim() ?? "";
  const explicit = query.length > 0;

  let ip: string;
  let hostname: string | null = null;

  if (!explicit) {
    const visitor = clientIp(request);
    if (!visitor || !isIP(visitor)) {
      return json(
        {
          error:
            "Could not determine your IP address. Enter an IP address or domain to look up.",
        },
        400,
      );
    }
    ip = visitor;
  } else if (isIP(query)) {
    ip = query;
  } else if (isHostname(query)) {
    hostname = query.toLowerCase();

    const resolved = await resolveHostname(hostname, fetchImpl);
    if ("error" in resolved) {
      return resolved.error === "not-found"
        ? json({ error: `No IP address found for ${hostname}.` }, 404)
        : json(
            { error: "Could not resolve that domain. Try again in a moment." },
            502,
          );
    }
    ip = resolved.ip;
  } else {
    return json({ error: "Enter a valid IP address or domain name." }, 400);
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

  return json(hostname ? { ...data, hostname } : data, 200, {
    "Cache-Control": explicit ? "public, max-age=300" : "no-store",
  });
}

type Resolved = { ip: string } | { error: "not-found" | "unavailable" };

interface DnsAnswer {
  type?: number;
  data?: string;
}

interface DnsResponse {
  Status?: number;
  Answer?: DnsAnswer[];
}

/**
 * Resolves a hostname to an address through Cloudflare's DNS-over-HTTPS
 * endpoint. IPv4 is preferred; AAAA is only queried when no A record exists,
 * so IPv4-only visitors keep working with dual-stack hostnames.
 */
async function resolveHostname(
  hostname: string,
  fetchImpl: FetchLike,
): Promise<Resolved> {
  for (const [record, recordType] of [
    ["A", 1],
    ["AAAA", 28],
  ] as const) {
    const upstream = new URL(DOH_ENDPOINT);
    upstream.searchParams.set("name", hostname);
    upstream.searchParams.set("type", record);

    let response: Response;
    try {
      response = await fetchImpl(upstream, {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      return { error: "unavailable" };
    }

    if (!response.ok) return { error: "unavailable" };

    let body: DnsResponse;
    try {
      body = (await response.json()) as DnsResponse;
    } catch {
      return { error: "unavailable" };
    }

    if (body.Status === 3) return { error: "not-found" }; // NXDOMAIN
    if (body.Status !== 0) return { error: "unavailable" };

    // CNAMEs are skipped here; the resolver follows them and appends the
    // matching A/AAAA record to the same answer section.
    const answer = (body.Answer ?? []).find(
      (entry) =>
        entry.type === recordType &&
        typeof entry.data === "string" &&
        isIP(entry.data),
    );

    if (answer?.data) return { ip: answer.data };
  }

  return { error: "not-found" };
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
