# SMT Security Upgrade (Authoritative Override)

**Effective**: Aug 23–Sep 13, 2025 transition; legacy FTPS & non-JWT API fully decommissioned at **Sep 13, 2025 12:02 AM CST**.

This repo **MUST** follow:
- **SFTP** for file pulls (replaces FTPS).
- **JWT** for SMT APIs (ad hoc retrieval).
- Webhook authentication **must** use `x-intelliwatt-secret` only (no `x-proxy-secret`).

## IntelliWatt SMT ingestion (current)
1. **Trigger** (Admin → SMT Tools or API): `POST /api/admin/smt/pull`
   - **Webhook mode** (default) → Calls droplet `:8787/trigger/smt-now` with header `x-intelliwatt-secret`.
   - **Inline mode** (`mode: "inline"`) → Accepts `content_b64` CSV payload; **now persists** to raw storage and DB.

2. **Persistence**
   - Files saved under `/adhocusage/<filename>` using our storage provider.
   - DB row inserted into `raw_smt_files` with fields: `filename`, `size_bytes`, `sha256`, `source`, `storage_path`, `content_type`, `received_at` (plus inline content for quick download).

3. **Inspection**
   - Admin inspector: `GET /api/admin/debug/smt/raw-files?limit=N`.

## Required env
- **Vercel**: `INTELLIWATT_WEBHOOK_SECRET` (64 chars), `ADMIN_TOKEN` (64 chars).
- **Droplet**: same `INTELLIWATT_WEBHOOK_SECRET`; webhook listens on `:8787/trigger/smt-now`.
- JWT for SMT API must follow SMT’s 2025 upgrade (managed in droplet codebase; not stored in this repo).

> This document **overrides** any bundled SMT PDFs or older instructions in this repository.
