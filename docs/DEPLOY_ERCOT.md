# ERCOT Daily Pull — Deploy & Verify

## Required env (Vercel → Settings → Environment Variables, Production):

- DATABASE_URL
- ADMIN_TOKEN
- CRON_SECRET
- PROD_BASE_URL = https://intelliwatt.com
- ERCOT_PAGE_URL = https://www.ercot.com/mp/data-products/market/tdsp-esiid-extracts
- (optional) ERCOT_PAGE_FILTER = TDSP
- (optional) ERCOT_USER_AGENT = Custom user agent string

## 1) Deploy main → Vercel

## 2) Verify cron exists in Vercel (0 9 * * *)

## 3) Sanity:

```bash
curl -sS "$PROD_BASE_URL/api/admin/ercot/debug/url-sanity" -H "x-admin-token: $ADMIN_TOKEN" | jq
```

## 4) Manual pull:

```bash
export ERCOT_TEST_URL="https://mdt.ercot.com/public/tdsp/TDSP_ESIID_Extract_2025-11-07.txt"
npm run ercot:fetch:latest
```

## 5) Force cron:

```bash
npm run ercot:resolve:fetch
```

## 6) Inspect ingests:

```bash
curl -sS "$PROD_BASE_URL/api/admin/ercot/ingests?limit=5" -H "x-admin-token: $ADMIN_TOKEN" | jq
```

