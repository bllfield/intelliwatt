# WattBuy API Testing Runbook

Quick reference for testing WattBuy retail-rates endpoints after deployment.

## Test Endpoints

### A) Explicit utilityID + state (Oncor)

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Returns retail rates for Oncor (utilityID 44372) in Texas.

### B) Derive from address (auto-derives utilityID)

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-test?address=9514%20Santa%20Paula%20Dr&city=Fort%20Worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Auto-derives utilityID from address via `/v3/electricity/info`, then fetches retail rates.

### C) Convenience by-address route

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-by-address?address=9514%20Santa%20Paula%20Dr&city=Fort%20Worth&state=tx&zip=76116" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Same as B, but with simpler path name.

### D) ZIP-only endpoint (auto-derives utilityID)

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-zip?zip=75201" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Auto-derives utilityID from ZIP code, then fetches retail rates.

**Note:** All endpoints require `state` to be lowercase (e.g., `tx` not `TX`). `utilityID` must be camelCase.

## Debugging Failures

If either endpoint fails:

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

3. **Compare against raw WattBuy API** from server:
   ```bash
   # On the server (or locally with WATTBUY_API_KEY set):
   # Note: WattBuy requires utilityID + state, not just zip
   curl -v "https://apis.wattbuy.com/v3/electricity/retail-rates?utilityID=44372&state=tx" \
     -H "x-api-key: $WATTBUY_API_KEY" \
     -H "accept: application/json"
   ```
   
   **Important:** WattBuy's `/v3/electricity/retail-rates` endpoint requires `utilityID` (camelCase) + `state` (lowercase). ZIP alone is not sufficient.

## Common Issues

- **403 Forbidden**: Check API key permissions in WattBuy dashboard
- **500 Internal Server Error**: Check server logs, verify `WATTBUY_API_KEY` is set
- **Empty results**: Verify ZIP code or utilityID is valid for Texas
- **Timeout**: Check network connectivity, retry logic should handle transient 5xx errors

## Using the Admin Inspector UI

Navigate to `/admin/wattbuy/inspector` for an interactive testing interface.

### Inspector Response Fields

After running tests, you'll see:

- **`topType`**: Whether the payload is an `array` or `object`
- **`topKeys`**: If object, what keys exist at the top level
- **`foundListPath`**: Which key contains the array (or `"(root)"` if the payload itself is the list)
- **`count`**: Number of items found (even when WattBuy doesn't return a root array)
- **`sample`**: First 3 items from the found array
- **`note`**: Diagnostic message if no array was found

### If `count = 0`

If the inspector shows `count = 0`, this indicates upstream content from WattBuy, not a code issue. When contacting WattBuy support, include:

1. **Request ID**: The `x-amzn-requestid` from the response headers (already captured)
2. **Exact selector used**: 
   - `utilityID=44372&state=tx` (if explicit)
   - Or the derived utilityID from address/zip (if auto-derived)
3. **Context**: Note that `/v3/electricity/info` for the same address/zip works, but `/v3/electricity/retail-rates` returns no list
4. **Metadata**: Include the `topType`, `topKeys`, and `foundListPath` values (helps them confirm the expected shape/field names for your product key)

### Updating Field Names

If WattBuy confirms a different field name for the array (e.g., `plans` vs `rates`), update the `candidates` list in `lib/wattbuy/inspect.ts`:

```typescript
const candidates = ['rates', 'plans', 'results', 'data', 'items'];
// Add the confirmed field name here
```

## Response Format

Successful response includes:
- `ok: true`
- `where`: Parameters sent to API
- `headers`: Diagnostic headers from WattBuy (including `x-amzn-requestid`, `x-documentation-url`, `x-amz-apigw-id`)
- `topType`: Payload structure type (`array`, `object`, etc.)
- `topKeys`: Top-level keys (if object)
- `foundListPath`: Path to the array (`rates`, `plans`, `(root)`, etc.)
- `count`: Number of results found
- `sample`: First 3 items (for quick inspection)
- `note`: Diagnostic message (if applicable)

Error response includes:
- `ok: false`
- `status`: HTTP status code
- `error`: Error message/text
- `headers`: Diagnostic headers (if available)
- `where`: Parameters that were sent

