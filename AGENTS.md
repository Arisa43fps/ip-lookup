# AGENTS.md

Single-page IP lookup: static files in `public/` served by Workers Assets, plus
one Worker API in `src/`. There is no frontend build step or framework.

## Commands

- `npm run dev` — Wrangler at http://localhost:8787.
- `npm run check` — typecheck then tests; run before finishing.
- `npx vitest run test/app.spec.ts -t "visitor IP"` — one test.
- `npm run cf-typegen` — regenerate `worker-configuration.d.ts` after changing
  bindings or secrets in `wrangler.jsonc`; keep the generated file. Do not
  hand-edit it.
- `npx wrangler deploy --dry-run` — validate the bundle without deploying.
- `npm run deploy` — deploy; requires `npx wrangler login`.

## Setup and secrets

- Local: copy `.dev.vars.example` to `.dev.vars` and set `IPINFO_TOKEN` from
  https://ipinfo.io/dashboard/token.
- Production: `npx wrangler secret put IPINFO_TOKEN`.
- The token is a Worker secret. Never put it in `public/` or in `wrangler.jsonc`
  `vars`; the browser must never receive it.
- `wrangler.jsonc` declares `secrets.required = ["IPINFO_TOKEN"]`, so
  `wrangler types` generates `Env.IPINFO_TOKEN`; `wrangler dev` warns if it is
  absent. Tests inject their own token.
- `npm audit` flags dev-only advisories in Wrangler/Miniflare's `undici`/`zod`.
  The deployed Worker has no npm runtime dependencies; do not downgrade Wrangler
  or run `npm audit fix --force` to silence them.

## Architecture gotchas

- `assets.run_worker_first` is `true`: every request enters `src/index.ts`.
  Non-`/api/*` requests must fall through to `env.ASSETS.fetch(request)`;
  removing that fallback breaks the site.
- `GET /api/ip` uses `CF-Connecting-IP` for the visitor, then calls
  `https://api.ipinfo.io/lite/{ip}?token=...`. Do not call `/lite/me` from the
  Worker: it returns the Worker's egress IP, not the visitor's.
- `?ip=` accepts a hostname too: `isHostname` validates it, then
  `resolveHostname` queries `https://cloudflare-dns.com/dns-query` (A, then
  AAAA) and the result is looked up like any other IP. The response echoes
  `hostname` so the UI can show what was resolved.
- IPinfo Lite only returns country/continent and ASN fields (`ip`, `asn`,
  `as_name`, `as_domain`, `country_code`, `country`, `continent_code`,
  `continent`, plus optional `bogon`/`anycast`). Do not add city or lat/lon UI.
- `handleRequest` takes an injectable fetch (`FetchLike`) so tests stay
  network-free. Keep upstream calls behind it.
- `serveAsset` adds the CSP and security headers. Inline scripts/styles are
  blocked by CSP; put JS in `public/*.js` and CSS in `public/styles.css`.
  Country flags are vendored in `public/flags/*.svg` and served from the same
  origin, so `img-src` stays `'self' data:` — do not add a CDN back.
- `public/theme.js` applies the saved theme before CSS paints. The storage key is
  `ip-lookup-theme`; the dark selector is `[data-theme="dark"]`. Keep them in sync.
- No frontend build: edit `public/` directly. Wrangler uploads that directory as
  assets; `src/` handles the API and the asset fallback.

## Tests

- `npm test` runs in workerd via `@cloudflare/vitest-plugin`.
  `test/app.spec.ts` stubs IPinfo and Cloudflare DoH; `test/ip.spec.ts` and
  `test/host.spec.ts` cover IP and hostname validation.
- Add API or validation cases to those files. Tests must not require network
  access or a real token.
- `vitest.config.ts` injects a test token, so tests do not need `.dev.vars`.
