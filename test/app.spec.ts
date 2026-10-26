import { describe, expect, it, vi } from "vitest";
import { handleRequest, type FetchLike } from "../src/app";

const sample = {
  ip: "8.8.8.8",
  asn: "AS15169",
  as_name: "Google LLC",
  as_domain: "google.com",
  country_code: "US",
  country: "United States",
  continent_code: "NA",
  continent: "North America",
};

function makeEnv(overrides: Partial<Env> = {}): Env {
  const assets = {
    fetch: vi.fn(async () => new Response("asset")),
  } as unknown as Fetcher;

  return {
    IPINFO_TOKEN: "test-token",
    ASSETS: assets,
    ...overrides,
  } as Env;
}

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://example.com${path}`, init);
}

function calledUrl(fetchMock: ReturnType<typeof vi.fn<FetchLike>>): URL {
  const input = fetchMock.mock.calls[0]?.[0];
  if (!input) throw new Error("Expected the upstream fetch to be called");

  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

function calledUrls(fetchMock: ReturnType<typeof vi.fn<FetchLike>>): URL[] {
  return fetchMock.mock.calls.map(([input]) => {
    if (input instanceof URL) return input;
    if (typeof input === "string") return new URL(input);
    return new URL(input.url);
  });
}

type DnsStub = Record<string, Response | object>;

/** Routes Cloudflare DoH calls to `dns` and everything else to `ipinfo`. */
function mockDns(
  dns: DnsStub,
  ipinfo: () => Response = () => Response.json(sample),
) {
  return vi.fn<FetchLike>(async (input) => {
    const url =
      input instanceof Request ? new URL(input.url) : new URL(String(input));
    if (url.hostname !== "cloudflare-dns.com") return ipinfo();

    const stub = dns[url.searchParams.get("type") ?? "A"];
    if (!stub) return Response.json({ Status: 0 });
    return stub instanceof Response ? stub : Response.json(stub);
  });
}

function mockUpstream(
  response: Response | (() => Response) = () => Response.json(sample),
) {
  return vi.fn<FetchLike>(async () =>
    typeof response === "function" ? response() : response,
  );
}

describe("GET /api/ip", () => {
  it("looks up the visitor IP from CF-Connecting-IP", async () => {
    const fetchMock = mockUpstream();

    const response = await handleRequest(
      makeRequest("/api/ip", { headers: { "CF-Connecting-IP": "8.8.8.8" } }),
      makeEnv(),
      fetchMock,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(sample);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const url = calledUrl(fetchMock);
    expect(url.origin).toBe("https://api.ipinfo.io");
    expect(url.pathname).toBe("/lite/8.8.8.8");
    expect(url.searchParams.get("token")).toBe("test-token");
  });

  it("falls back to X-Forwarded-For during local development", async () => {
    const fetchMock = mockUpstream();

    await handleRequest(
      makeRequest("/api/ip", {
        headers: { "X-Forwarded-For": "203.0.113.9, 10.0.0.1" },
      }),
      makeEnv(),
      fetchMock,
    );

    expect(calledUrl(fetchMock).pathname).toBe("/lite/203.0.113.9");
  });

  it("looks up an explicit IPv6 address and caches the result", async () => {
    const fetchMock = mockUpstream();

    const response = await handleRequest(
      makeRequest("/api/ip?ip=2001%3Adb8%3A%3A1"),
      makeEnv(),
      fetchMock,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(calledUrl(fetchMock).pathname).toBe("/lite/2001:db8::1");
  });

  it("rejects an invalid IP without calling IPinfo", async () => {
    const fetchMock = mockUpstream();

    const response = await handleRequest(
      makeRequest("/api/ip?ip=not-an-ip"),
      makeEnv(),
      fetchMock,
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing token without calling IPinfo", async () => {
    const fetchMock = mockUpstream();

    const response = await handleRequest(
      makeRequest("/api/ip?ip=8.8.8.8"),
      makeEnv({ IPINFO_TOKEN: "" }),
      fetchMock,
    );

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps an upstream 404 to a 404", async () => {
    const fetchMock = mockUpstream(
      () => new Response("not found", { status: 404 }),
    );

    const response = await handleRequest(
      makeRequest("/api/ip?ip=8.8.8.8"),
      makeEnv(),
      fetchMock,
    );

    expect(response.status).toBe(404);
  });

  it("maps upstream failures to 502", async () => {
    const fetchMock = mockUpstream(
      () => new Response("server error", { status: 500 }),
    );

    const response = await handleRequest(
      makeRequest("/api/ip?ip=8.8.8.8"),
      makeEnv(),
      fetchMock,
    );

    expect(response.status).toBe(502);
  });

  it("rejects non-GET requests", async () => {
    const fetchMock = mockUpstream();

    const response = await handleRequest(
      makeRequest("/api/ip", { method: "POST" }),
      makeEnv(),
      fetchMock,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/ip with a domain", () => {
  it("resolves the domain, then looks up the resulting IP", async () => {
    const fetchMock = mockDns(
      {
        A: {
          Status: 0,
          Answer: [{ name: "example.com.", type: 1, data: "93.184.216.34" }],
        },
      },
      () => Response.json({ ...sample, ip: "93.184.216.34" }),
    );

    const response = await handleRequest(
      makeRequest("/api/ip?ip=Example.COM"),
      makeEnv(),
      fetchMock,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ip: "93.184.216.34",
      hostname: "example.com",
    });
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");

    const urls = calledUrls(fetchMock);
    expect(urls).toHaveLength(2);
    expect(urls[0]?.hostname).toBe("cloudflare-dns.com");
    expect(urls[0]?.searchParams.get("name")).toBe("example.com");
    expect(urls[0]?.searchParams.get("type")).toBe("A");
    expect(urls[1]?.pathname).toBe("/lite/93.184.216.34");
  });

  it("falls back to AAAA when there is no A record", async () => {
    const fetchMock = mockDns(
      {
        AAAA: {
          Status: 0,
          Answer: [{ name: "example.com.", type: 28, data: "2001:db8::1" }],
        },
      },
      () => Response.json({ ...sample, ip: "2001:db8::1" }),
    );

    const response = await handleRequest(
      makeRequest("/api/ip?ip=example.com"),
      makeEnv(),
      fetchMock,
    );

    expect(response.status).toBe(200);
    expect(calledUrls(fetchMock).map((url) => url.pathname)).toEqual([
      "/dns-query",
      "/dns-query",
      "/lite/2001:db8::1",
    ]);
  });

  it("ignores non-matching records such as CNAMEs", async () => {
    const fetchMock = mockDns(
      {
        A: {
          Status: 0,
          Answer: [
            { name: "example.com.", type: 5, data: "edge.example.net." },
            { name: "edge.example.net.", type: 1, data: "93.184.216.34" },
          ],
        },
      },
      () => Response.json({ ...sample, ip: "93.184.216.34" }),
    );

    const response = await handleRequest(
      makeRequest("/api/ip?ip=example.com"),
      makeEnv(),
      fetchMock,
    );

    expect(response.status).toBe(200);
    expect(calledUrls(fetchMock)[1]?.pathname).toBe("/lite/93.184.216.34");
  });

  it("returns 404 when the domain has no address", async () => {
    const fetchMock = mockDns({ A: { Status: 3 } });

    const response = await handleRequest(
      makeRequest("/api/ip?ip=missing.example"),
      makeEnv(),
      fetchMock,
    );

    expect(response.status).toBe(404);
    expect(calledUrls(fetchMock)).toHaveLength(1);
  });

  it("maps resolver failures to 502", async () => {
    const fetchMock = mockDns({ A: new Response("boom", { status: 500 }) });

    const response = await handleRequest(
      makeRequest("/api/ip?ip=example.com"),
      makeEnv(),
      fetchMock,
    );

    expect(response.status).toBe(502);
  });

  it("rejects a malformed hostname without resolving it", async () => {
    const fetchMock = mockDns({});

    const response = await handleRequest(
      makeRequest("/api/ip?ip=exa_mple.com"),
      makeEnv(),
      fetchMock,
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("static assets", () => {
  it("falls through to the assets binding with security headers", async () => {
    const assetsFetch = vi.fn(
      async () =>
        new Response("<h1>Hello</h1>", {
          headers: { "Content-Type": "text/html" },
        }),
    );
    const env = makeEnv({
      ASSETS: { fetch: assetsFetch } as unknown as Fetcher,
    });

    const response = await handleRequest(makeRequest("/"), env);

    expect(assetsFetch).toHaveBeenCalledOnce();
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    // Flags are vendored in public/flags, so no third-party image host is needed.
    expect(csp).not.toContain("flagcdn");
    expect(await response.text()).toBe("<h1>Hello</h1>");
  });

  it("returns a JSON 404 for unknown API routes", async () => {
    const response = await handleRequest(
      makeRequest("/api/nope"),
      makeEnv(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found." });
  });
});
