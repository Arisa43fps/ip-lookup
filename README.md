# IP Lookup

A fast, lightweight IP address lookup for Cloudflare Workers. The frontend is
plain HTML, CSS, and JavaScript. The Worker keeps your IPinfo token server-side
and proxies requests to the [IPinfo Lite API](https://ipinfo.io/developers/lite-api).

## Features

- Detects the visitor's public IPv4 or IPv6 address via `CF-Connecting-IP`
- Looks up any IPv4 or IPv6 address
- Shows country, continent, ASN, organization, and domain
- Light and dark themes, persisted per browser
- Responsive layout, accessible controls, and no frontend build step
- Original SVG logo and favicon in `public/logo.svg`

## Local setup

Requires Node.js 22.12 or newer and a free IPinfo account.

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
# Edit .dev.vars and set IPINFO_TOKEN to your token from
# https://ipinfo.io/dashboard/token
npm run dev
```

Open http://localhost:8787. `wrangler dev` serves the static files and the
`/api/ip` route together.

## Commands

| Command                    | What it does                                             |
| -------------------------- | -------------------------------------------------------- |
| `npm run dev`              | Start the local Wrangler server on port 8787             |
| `npm run check`            | Typecheck, then run the test suite                       |
| `npm test`                 | Run Vitest once (tests run in the Workers runtime)       |
| `npm run test:watch`       | Run Vitest in watch mode                                 |
| `npm run cf-typegen`       | Regenerate `worker-configuration.d.ts`                   |
| `npm run deploy`           | Deploy the Worker and assets to Cloudflare               |

Run a single test with:

```powershell
npx vitest run test/app.spec.ts -t "visitor IP"
```

## API

`GET /api/ip` looks up the caller's address using `CF-Connecting-IP`.

`GET /api/ip?ip=8.8.8.8` looks up a specific IPv4 or IPv6 address.

Successful responses pass through the IPinfo Lite fields:

```json
{
  "ip": "8.8.8.8",
  "asn": "AS15169",
  "as_name": "Google LLC",
  "as_domain": "google.com",
  "country_code": "US",
  "country": "United States",
  "continent_code": "NA",
  "continent": "North America"
}
```

Errors use `{ "error": "..." }` with a 4xx or 5xx status. The endpoint is
same-origin only; no CORS headers are sent.

## Deploy

```powershell
npx wrangler login
npx wrangler secret put IPINFO_TOKEN
npm run deploy
```

The Worker name is `ip-lookup` in `wrangler.jsonc`. Add a custom domain or route
there if you want to use your own hostname. To validate a build without
deploying:

```powershell
npx wrangler deploy --dry-run
```

## Project layout

```
src/
  index.ts          Worker entrypoint
  app.ts            Routing, IPinfo proxy, security headers
  lib/ip.ts         IPv4/IPv6 validation
public/
  index.html        Single-page UI
  app.js            Lookup, rendering, copy, theme toggle
  theme.js          Applies the saved theme before CSS paints
  styles.css        Light/dark responsive styles
  logo.svg          Logo and favicon
test/
  app.spec.ts       API behavior with a stubbed IPinfo fetch
  ip.spec.ts        IP validation tables
```

## Notes

- The IPinfo token is never exposed to the browser. Keep it in `.dev.vars` locally
  and in a Worker secret in production.
- The Worker calls `/lite/{ip}` rather than `/lite/me`, because `/lite/me` would
  resolve to the Worker's egress IP instead of the visitor's address.
- The theme preference is stored under the `ip-lookup-theme` localStorage key.
- The logo is an original SVG included with this project and is free to use.
