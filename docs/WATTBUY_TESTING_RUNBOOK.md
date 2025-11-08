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

## Response Format

Successful response includes:
- `ok: true`
- `where`: Parameters sent to API
- `headers`: Diagnostic headers from WattBuy
- `count`: Number of results (if array)
- `sample`: First 3 items (for quick inspection)

Error response includes:
- `ok: false`
- `status`: HTTP status code
- `error`: Error message/text
- `headers`: Diagnostic headers (if available)
- `where`: Parameters that were sent

