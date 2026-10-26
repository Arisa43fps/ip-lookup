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
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
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
