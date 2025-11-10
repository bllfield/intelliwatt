# Testing IntelliWatt API Endpoints (Prod & Preview)

## Why do I need to pass tokens if I have `.env.local`?

- `.env.local` is loaded by the **server** when you run locally.

- From your terminal against a deployed URL, you're an external client — admin routes still require `x-admin-token`.

- Prod env vars live in Vercel → Project → Settings → Environment Variables.

## Deployment URLs

- Production: `https://intelliwatt.com`

- Preview example: `https://<project>-<hash>-vercel.app`

## Automated Node smoke test (Cursor / CI)

1. `npm i -g vercel` and `vercel login`

2. Pull prod envs: `vercel env pull .env.vercel --environment=production`

3. Run: `node scripts/admin/api_test_prod.mjs --base https://intelliwatt.com`

   - or: `npm run test:prod -- https://intelliwatt.com`

## Quick sanity endpoints

- Public ping: `GET /api/ping` → `{ ok: true, ... }`

- Text ping: `GET /api/ping.txt` → `OK`

- Env health: `GET /api/admin/env-health` with `x-admin-token: <ADMIN_TOKEN>`

## ERCOT quick verify (admin/cron)

```bash
# URL sanity (admin)
curl -sS "$BASE/api/admin/ercot/debug/url-sanity" -H "x-admin-token: $ADMIN_TOKEN" | jq

# Manual fetch by explicit URL (admin) - set ERCOT_TEST_URL in Vercel or pass ?url=
curl -sS "$BASE/api/admin/ercot/fetch-latest?url=$ERCOT_TEST_URL" -H "x-admin-token: $ADMIN_TOKEN" | jq

# List recent ingests (admin)
curl -sS "$BASE/api/admin/ercot/ingests" -H "x-admin-token: $ADMIN_TOKEN" | jq

# Cron (header)
curl -sS "$BASE/api/admin/ercot/cron" -H "x-cron-secret: $CRON_SECRET" | jq
# Cron (query)
curl -sS "$BASE/api/admin/ercot/cron?token=$CRON_SECRET" | jq
```

**Notes:**
- Set `ERCOT_PAGE_URL` as in `DEPLOY_ERCOT.md`.
- Use `ERCOT_TEST_URL` for a known file to validate ingestion.
- Idempotent: repeated runs skip duplicates by `fileSha256`.

## WattBuy API Testing

### Retail Rates Endpoints

**Note:** WattBuy API requires `utilityID` (camelCase) + `state` (lowercase). We support auto-derivation from address.

#### A) Explicit utilityID + state (Oncor)

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Returns retail rates for Oncor (utilityID 44372) in Texas.

#### B) Derive from address (auto-derives utilityID)

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-test?address=9514%20Santa%20Paula%20Dr&city=Fort%20Worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Auto-derives utilityID from address via `/v3/electricity/info`, then fetches retail rates.

#### C) Convenience by-address route

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-by-address?address=9514%20Santa%20Paula%20Dr&city=Fort%20Worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Same as B, but with simpler path name.

#### D) ZIP-only endpoint (auto-derives utilityID)

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-zip?zip=75201" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Auto-derives utilityID from ZIP code, then fetches retail rates.

**Note:** All endpoints require `state` to be lowercase (e.g., `tx` not `TX`). `utilityID` must be camelCase.

### Electricity Catalog (Robust)

The robust electricity endpoint implements 3-strategy fallback for maximum reliability:

```bash
# With address (recommended)
curl -sS "https://intelliwatt.com/api/admin/wattbuy/electricity?address=9514%20santa%20paula%20dr&city=fort%20worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq

# Using electricity-probe endpoint (dedicated testing)
curl -sS "https://intelliwatt.com/api/admin/wattbuy/electricity-probe?address=9514%20santa%20paula%20dr&city=fort%20worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Fallback Strategy:**
1. Direct call with uppercase state (e.g., `TX`)
2. Retry with lowercase state (e.g., `tx`)
3. Fallback to `wattkey` lookup via `/v3/electricity/info`

**Response includes:**
- `usedWattkey`: Boolean indicating if fallback was used
- `shape`: Payload structure metadata (`topType`, `keys`)
- `headers`: Diagnostic headers from WattBuy
- `data`: Full response payload

### Using the Admin Inspector UI

Navigate to `/admin/wattbuy/inspector` for an interactive testing interface.

**Inspector Response Fields:**
- `topType`: Whether the payload is an `array` or `object`
- `topKeys`: If object, what keys exist at the top level
- `foundListPath`: Which key contains the array (or `"(root)"` if the payload itself is the list)
- `count`: Number of items found (even when WattBuy doesn't return a root array)
- `sample`: First 3 items from the found array
- `note`: Diagnostic message if no array was found

**If `count = 0`:** This indicates upstream content from WattBuy, not a code issue. When contacting WattBuy support, include:
1. **Request ID**: The `x-amzn-requestid` from the response headers
2. **Exact selector used**: `utilityID=44372&state=tx` (if explicit) or the derived utilityID
3. **Metadata**: Include the `topType`, `topKeys`, and `foundListPath` values

### Debugging WattBuy Failures

1. **Inspect diagnostic headers** in the JSON response:
   ```bash
   # Look for these fields in the response:
   .headers.x-amzn-requestid      # AWS request ID for support
   .headers['x-documentation-url'] # API documentation link
   .headers['x-amz-apigw-id']     # API Gateway ID
   ```

2. **Try both selectors** to isolate the issue:
   - ZIP-based: `?zip=75201`
   - Utility+State: `?utilityID=44372&state=tx`

3. **Common Issues:**
   - **403 Forbidden**: Check API key permissions in WattBuy dashboard
   - **500 Internal Server Error**: Check server logs, verify `WATTBUY_API_KEY` is set
   - **Empty results**: Verify ZIP code or utilityID is valid for Texas
   - **Timeout**: Check network connectivity, retry logic should handle transient 5xx errors
