# WattBuy API Testing Runbook

Quick reference for testing WattBuy retail-rates endpoints after deployment.

## Test Endpoints

### 1. Test with utilityID + state (Oncor)

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Returns retail rates for Oncor (utilityID 44372) in Texas.

### 2. Test with ZIP code

```bash
curl -sS "https://intelliwatt.com/api/admin/wattbuy/retail-rates-zip?zip=75201" \
  -H "x-admin-token: $ADMIN_TOKEN" | jq
```

**Expected:** Returns retail rates for ZIP code 75201 (Dallas, TX).

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
   curl -v "https://apis.wattbuy.com/v3/electricity/retail-rates?zip=75201" \
     -H "x-api-key: $WATTBUY_API_KEY" \
     -H "accept: application/json"
   ```

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

