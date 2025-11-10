# Testing IntelliWatt API Endpoints (Prod & Preview)

## Why do I need to pass tokens if I have `.env.local`?

- `.env.local` is loaded by the Next.js **server** when you run locally.

- When you call a deployed endpoint from your shell, you are an **external client**—the server still expects `x-admin-token` (or other headers) to prove admin access.

- Production env vars live in Vercel → Project → Settings → Environment Variables. Your local file does **not** apply to Vercel automatically.

## Deployment URLs

- Production domain: `https://intelliwatt.com`

- Production deployment URL example: `https://<project>-<hash>-vercel.app`

## Quick sanity

- Public ping (no token): `GET /api/ping` → `{ ok: true, service: "intelliwatt", ts: "..." }`

- Admin env health (token required): `GET /api/admin/env-health` with header `x-admin-token: <ADMIN_TOKEN>`

## Admin testing targets (current)

- **WattBuy Electricity (robust):** `GET /api/admin/wattbuy/electricity-probe?address=...&city=...&state=tx&zip=...`

- **Retail Rates (explicit):** `GET /api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx`

- **Retail Rates (by address):** `GET /api/admin/wattbuy/retail-rates-by-address?address=...&city=...&state=tx&zip=...`

- **Retail Rates (zip auto-derive):** `GET /api/admin/wattbuy/retail-rates-zip?zip=75201`

All require the header: `x-admin-token: <ADMIN_TOKEN>`

## Cron tests (unchanged)

- Cron echo (secret required): `GET /api/admin/ercot/debug/echo-cron` with header `x-cron-secret: <CRON_SECRET>`

- Manual ERCOT cron trigger: `GET /api/admin/ercot/cron` with header `x-cron-secret: <CRON_SECRET>`

## Recommended flow

1. **Ping** → confirm deployment is up.

2. **Env health** → verify keys present (WATTBUY_API_KEY, ADMIN_TOKEN).

3. **Electricity Probe** → confirm 200 with payload (or wattkey fallback).

4. **Retail Rates** → test explicit `utilityID+state`; if 204, try **by-address** to cycle alternates.

5. If retail rates return 204 for TX TDSPs, include `x-amzn-requestid` + `x-documentation-url` in support emails.

