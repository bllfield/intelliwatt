# IntelliWatt Admin API — Safe Usage

## Why this exists
Admin/debug endpoints are **gated** with `x-admin-token`. To avoid 401s and keep secrets out of the repo, use the wrapper script so the token is injected automatically.

## One-time setup (local shell)
```powershell
# Set your token for this session (never commit secrets)
$env:ADMIN_TOKEN = '<YOUR_ADMIN_TOKEN>'
```

## Calling endpoints
```powershell
# GET — Production
.\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://intelliwatt.com/api/debug/list-all-addresses'

# GET — Preview
.\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://<your-preview>.vercel.app/api/debug/check-address?email=bllfield@yahoo.com'

# POST — Cleanup
.\scripts\admin\Invoke-Intelliwatt.ps1 -Uri 'https://<your-env>.vercel.app/api/debug/cleanup' -Method POST
```

## Notes
- The script reads `ADMIN_TOKEN` from your **current PowerShell session** (`$env:ADMIN_TOKEN`).
- No secrets are stored in the repo.
- Use **Production token** for `intelliwatt.com` and **Preview token** for `*.vercel.app` if they differ.
- If you rotate tokens in Vercel, update your local `$env:ADMIN_TOKEN` and re-run.

## Troubleshooting
- `401 Unauthorized`: wrong/missing token, wrong environment, or header stripped by tool.
- `503 Admin token not configured`: env var missing at runtime; ensure **Vercel env** is set and redeploy.

## Admin Route Policy

### Security Requirements
- All `/api/debug/*`, `/api/migrate`, and `/api/admin/*` endpoints are admin-gated
- **Production** requires `ADMIN_TOKEN` in Vercel and every request must include header: `x-admin-token: <ADMIN_TOKEN>`
- **Preview/Dev** adds flexibility: if `ADMIN_TOKEN` is set, require it; if unset, allow access (to avoid lockout)
- **Never** include `ADMIN_TOKEN` in client/browser code

### How to Call Admin Routes
- Use the wrapper script: `scripts/admin/Invoke-Intelliwatt.ps1`
- The script reads `$env:ADMIN_TOKEN` and automatically adds `x-admin-token` header
- For any admin/debug requests in automation, Cursor should call the wrapper instead of raw `Invoke-RestMethod`

### Operational Notes
- After changing env vars in Vercel, redeploy
- Prod token and Preview token may differ; set `$env:ADMIN_TOKEN` accordingly in your shell before using the wrapper

