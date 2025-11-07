# IntelliWatt Architecture Standards (Core)

## Core Principles

### CDM-First Approach
- **UI consumes Canonical Data Model endpoints only**
- All user-facing data must flow through normalized, validated endpoints
- Raw data is stored separately and transformed before UI consumption
- No direct database queries in UI components

### RAW Storage Before Normalization
- **Always store raw payloads before processing**
- Preserve original data in `rawGoogleJson`, `rawWattbuyJson`, etc.
- Transform and normalize in separate steps
- Enable data reprocessing and debugging without re-fetching

### API Versioning Strategy
- **Internal APIs versioned: `/api/v1/...`**
- Breaking changes require new version (v2, v3, etc.)
- Maintain backward compatibility for at least one version
- Document version lifecycle and deprecation timeline

### Idempotent Ingestion
- **Deduplicate by (source_id, timestamp)**
- All data ingestion must be re-runnable
- Handle duplicate submissions gracefully
- Use upsert patterns for data consistency

### Safe Migration Patterns
- **Deprecate → Backfill → Cutover → Remove**
- Never remove old systems until new ones are proven
- Maintain parallel systems during transition
- Document rollback procedures

## Observability Requirements

### Correlation Tracking
- **Every request must have correlation ID**
- Use `x-corr-id` header or generate UUID
- Include correlation ID in all logs and responses
- Track request flow across services

### Required Log Fields
- `corrId`: Correlation identifier
- `route`: API endpoint path
- `durationMs`: Request processing time
- `status`: HTTP status code
- `errorClass`: Error categorization

### Metrics to Track
- `unmapped_fields_count`: Data transformation issues
- `transformer_errors`: Processing failures
- `esiid_resolution_rate`: Address validation success
- `api_response_times`: Performance monitoring

## Security Practices

### Environment Variables
- **Secrets stored in environment variables only**
- Never commit API keys or credentials
- Use different keys per environment
- Rotate keys on project changes

### API Key Restrictions
- **Google API keys restricted by referrer**
- Limit API access to specific domains/IPs
- Monitor usage and set quotas
- Implement rate limiting

### PII Handling
- **Do not log PII values**
- Hash sensitive data when useful for debugging
- Minimize PII exposure in responses
- Implement data retention policies

## UI Resilience

### Safe Response Shapes
- **Always return UI-safe shapes**
- Guard against null/undefined values
- Provide sensible defaults
- Handle partial data gracefully

### Loading States
- **Use skeletons for loading states**
- Show progress indicators for long operations
- Implement timeout handling
- Provide retry mechanisms

## Health Monitoring

### Health Endpoints
- **Primary**: `/api/health` (App Router at `app/api/health/route.ts`)
- **Optional**: `/api/deps/wattbuy` for upstream dependency checks
- Return `{ ok, db, corrId }` with appropriate status codes
- Include structured logging for monitoring

### Database Health
- Simple ping using `prisma.$queryRaw`
- Return 200 for healthy, 503 for unhealthy
- Include response time in logs
- Monitor connection pool status

## Implementation Guidelines

### File Organization
- Keep related functionality in modules
- Use consistent naming conventions
- Document public APIs thoroughly
- Maintain backward compatibility

### Error Handling
- Use structured error responses
- Include correlation IDs in error logs
- Categorize errors by type
- Provide actionable error messages

### Performance
- Implement caching strategies
- Monitor response times
- Use connection pooling
- Optimize database queries

## Operational Standards
### Deployment Model — Git via Vercel
- Production deploys are triggered only by pushing to the Production branch (`main`).
- `vercel.json` schedules (cron jobs) take effect on the next Git deploy.
- The DigitalOcean droplet is reserved for SMT ingestion/testing; do **not** deploy the web app from the droplet.

### Development Model — Cursor GPT Blocks
- All code edits must be delivered as single, copy-ready GPT blocks inside Cursor.
- Each block must specify: Model (GPT-4o), Thinking (With Thinking), Agent (OFF), and Files to target.
- Avoid `&&` in shell commands; provide one command per line.

## Authentication Standards
### Admin Routes
- All `/api/admin/*` and `/api/debug/*` endpoints require `x-admin-token` matching `ADMIN_TOKEN`.
- On failure, return `{ ok: false, error: 'unauthorized' }` (HTTP 401).
- Never echo secrets or raw PII in responses or logs.

### Scheduled (Cron) Routes
- Vercel-scheduled routes must validate the `x-vercel-cron` header.
- Support optional `CRON_SECRET` via `x-cron-secret` header or `?token=` for manual smoke tests.
- Cron handlers must be idempotent (hash-skip, upsert) and produce structured logs.

## Data Domains (RAW → CDM)
### ERCOT ESIID Index
- RAW capture: store downloaded ERCOT extracts and response metadata before processing.
- Idempotence: compute/persist file hash; skip duplicate ingests.
- Normalization: load into `ErcotEsiidIndex`, USPS-normalize addresses, support fuzzy match (`pg_trgm`) for ZIP + line1.
- Admin tools:
  - `/api/admin/ercot/cron` (scheduled) — resolves, downloads, hash-skips.
  - `/api/admin/ercot/fetch-latest` (manual) — fetches a specified URL.
  - `/api/admin/ercot/ingests` — lists ingest history with filters (date/status/tdsp/limit).
- UI consumption remains CDM-shaped; never couple UI to vendor schemas.

## Health & Debug Endpoints (Non-PII)
- **Primary Health:** `/api/health` → `{ ok, db, corrId }`.
- **Env Health:** `/api/admin/env-health` → boolean presence of required env vars (token-gated; no values shown).
- **ERCOT Debug:**
  - `/api/admin/ercot/debug/last` → most recent ingest row (token-gated).
  - `/api/admin/ercot/debug/echo-cron` → confirms cron headers/secret, no side effects.

## Observability Cross-Reference
- Log `corrId`, route, status, durationMs, errorClass for every route.
- Track data-quality counters (e.g., `unmapped_fields_count`, `transformer_errors`) per OBSERVABILITY.md.
- Use structured JSON logs and avoid printing raw PII; hash when necessary.

## PII Handling (Reminder)
- Treat ESIID, addresses, names as PII.
- Do not log raw values; store only what is required in RAW stores and CDM tables.
- Mask or hash PII in logs/diagnostics; never echo secrets in responses.