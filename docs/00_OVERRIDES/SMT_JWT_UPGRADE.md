# SMT Interface Upgrade — OVERRIDE (Effective 2025-09-13) ✅

**This document supersedes and overrides all prior SMT integration notes in this repo.**  
Scope: FTP/API integration only. Website portal access unaffected (per SMT).

## What changed

- **FTPS → SFTP** for REP/CSP file downloads, enrollment reporting, and subscription reporting.  
- **API now requires JSON Web Tokens (JWT)** for ad-hoc reporting retrieval.  
- Decommissioned: FTPS and API **without** JWT as of **2025-09-13 00:02 A.M. CST**.

## What stays the same in our stack

- Droplet service handles **SFTP** fetch/decrypt **and** **webhook** POST back to Vercel.  
- Vercel API remains system-of-record for storing raw files and intervals.

## Required behavior in our code (authoritative)

1. **SFTP**  
   - Remote host: `ftp.smartmetertexas.biz`  
   - Auth: OpenSSH keypair (private on droplet), *comment/label may change without changing key material*.  
   - Remote drop dir: currently `/adhocusage`.  
   - `.env` keys (droplet):  
     - `SMT_SFTP_HOST`, `SMT_SFTP_PORT=22`, `SMT_SFTP_USER`, `SMT_SFTP_KEY_PATH`, `SMT_SFTP_REMOTE_DIR=/adhocusage`

2. **API (JWT)**  
   - All SMT **API** calls must include a **Bearer JWT** in `Authorization` header.  
   - Our connector must:
     - Obtain token from SMT’s auth endpoint (REP/CSP credential pair issued by SMT).  
     - Cache token for its lifetime (commonly ~30m).  
     - Refresh automatically on 401/expiry.
   - **Implementation directive**: Any script that previously called SMT API without JWT is **invalid** and must be updated.

3. **Droplet ↔ Vercel Webhook contract**

   - Vercel → Droplet trigger:  
     - `DROPLET_WEBHOOK_URL="http://<DROPLET_IP>:8787/trigger/smt-now"`  
     - `DROPLET_WEBHOOK_SECRET` header: `x-intelliwatt-secret: <secret>`  
   - Droplet → Vercel ingest (inline mode, inspector-friendly):  
     - `POST /api/admin/smt/pull` with **headers**:  
       - `x-intelliwatt-secret: <same as Vercel INTELLIWATT_WEBHOOK_SECRET>`  
       - `x-admin-token: <ADMIN_TOKEN>`  
     - **Body (inline)**:
       ```json
       {
         "filename": "adhoc_1044XXXX_usage_YYYY-MM-DD.csv",
         "mime": "text/csv",
         "encoding": "base64",
         "content_b64": "<BASE64_BYTES>",
         "esiid": "1044XXXXXXXXXXXXXX",
         "meter": "M1",
         "captured_at": "2025-11-11T19:30:10Z"
       }
       ```
     - If using external object storage, inspector must fetch via `storage_path` on download.

4. **Header names (authoritative)**

   - **Use**: `x-intelliwatt-secret` (Vercel↔Droplet auth), `x-admin-token` (Vercel admin routes).  
   - **Do not use**: legacy `x-proxy-secret` in any new code paths.

5. **Logging + Proof**

   - Proxy `/run-once` must log `{status:"ok", fetched, decrypted, processed_files, sent}` with non-zero values for a successful cycle.  
   - Admin inspector will show **Raw SMT Files** with working **Download** when inline content is present.

## Cursor tasks (find/flag for JWT retrofit)

- Search for any code under `smt_ingest/` and Vercel routes referencing SMT API without JWT.
- Add TODO tags where JWT must be added:
  - `// TODO[SMT-JWT]: obtain+cache JWT, add Authorization: Bearer <token>`
  - `// TODO[SMT-JWT]: refresh token on 401, backoff, retry once`
- Ensure webhook server and droplet scripts read **INTELLIWATT_WEBHOOK_SECRET** from `~/.intelliwatt.env` and/or `/home/deploy/smt_ingest/.env`.

## Test checklist (authoritative “Done Criteria”)

- `sftp>` login works, `ls -la /adhocusage` enumerates files (when SMT drops).  
- Manual cycle: `fetched>0`, `decrypted>0`, `sent>0`.  
- Admin inspector shows a new **Raw SMT File** with inline **Download** working.  
- JWT flow validated: API calls succeed only when `Authorization: Bearer <token>` is present.

> **This file is the override source of truth. If any SMT doc in this repo conflicts with the above, this file wins.**

## Retrofit Map

- [ ] scripts/setup-laptop-dev.ps1 (line 229): update SFTP host instructions to reflect JWT/SFTP override.
- [ ] app/api/admin/analysis/daily-summary/route.ts (lines 49-153): confirm new SMT env naming and JWT-protected ingest references.
- [ ] app/api/admin/wattbuy/property-bundle/route.ts (lines 134-155): ensure webhook calls honor INTELLIWATT secrets and inline payload contract.
- [ ] docs/ENV_VARS.md & scripts/smoke-test-deploy.ps1 (lines 62-129): align SMT_* env usage with consolidated `docs/env/SMT_ENV_VARS.md`.
- [ ] Verify external droplet repo adds JWT-handling TODOs (`// TODO[SMT-JWT]: ...`) where SMT API calls are issued (no direct callers in this repo).
