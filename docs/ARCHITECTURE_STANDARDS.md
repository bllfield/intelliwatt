# IntelliWatt Architecture Standards (Core)

## Core Principles

### CDM-First Approach
- **UI consumes Canonical Data Model endpoints only**
- All user-facing data must flow through normalized, validated endpoints
- Raw data is stored separately and transformed before UI consumption
- No direct database queries in UI components

### Usage Layer Naming Contract
- Usage/simulation contracts must use canonical layer names from `docs/USAGE_LAYER_MAP.md`.
- Code-level layer naming must use `modules/usageSimulator/kinds.ts` (`IntervalSeriesKind`).
- Avoid ambiguous terms like "baseline" without an explicit layer mapping.
- New endpoints must declare which single layer they return or persist.

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

## Single Implementation Rule

- The same functional logic may not exist in multiple files.
- Shared behavior must be implemented once in a canonical module and imported everywhere else.
- Controllers, routes, pages, and services may orchestrate modules but may not duplicate business logic.
- No duplicate derivation paths are allowed for the same output.
- No slightly modified copies of the same logic are allowed.
- If duplicate logic is found, it must be consolidated into one canonical module before further extension.
- Canonical artifacts produced by a module must not be recomputed differently elsewhere.
- This rule applies to calculations, transforms, aggregation, simulation steps, display derivation, and normalization logic.
- App Router/page files must stay thin and call modules, not implement business rules inline.

### Enforcement

- Reuse an existing module if similar logic already exists.
- Move logic into a shared module immediately if it will be used in more than one place.
- Refuse duplicate implementations.
- Prefer parameterized canonical functions over multiple near-duplicate functions.

### Shared Module Rule

- It is not allowed to implement the same function in two places.
- If logic is needed in multiple places, it must live in one shared module and be consumed from there.
- No duplicate or parallel implementations are allowed for interval derivation, simulated-day generation, daily aggregation, monthly aggregation, summary totals, overlays, bucket generation, or diagnostics transforms.
- If similar code already exists in multiple places, future work must consolidate toward one shared module path and must not add another path.

### Canonical Shared Module Usage (All Future Development)

- This rule is mandatory for all new runtime features, routes, pages, services, tools, and refactors.
- Routes/pages/tools may orchestrate, validate input, and format responses, but business logic must live in shared modules.
- No copy/paste variants or second implementations of existing aligned logic are allowed.
- If a shared module already exists, use it (or extend it) and do not create a parallel path.

#### 1) Canonical date/window logic

- All canonical date/window calculations must use shared Chicago-time helpers only.
- Use:
  - `lib/time/chicago.ts`
  - `modules/usageSimulator/canonicalWindow.ts`
- Do not add route-level date math for canonical windows unless unique and documented.

#### 2) Actual interval source selection + fetching

- All actual interval source selection/fetching must use shared modules.
- Use:
  - `modules/realUsageAdapter/actual.ts`
  - `lib/usage/actualDatasetForHouse.ts`
  - `lib/usage/resolveIntervalsLayer.ts`
- Do not create route-level SMT-first/GB-fallback source selection.
- Do not directly query interval tables from normal runtime flows if a shared module exists.

#### 3) Past corrected baseline / simulated-day generation

- All simulated-day generation must use shared simulator core modules.
- Use:
  - `modules/simulatedUsage/pastDaySimulator.ts`
  - `modules/simulatedUsage/engine.ts`
  - `modules/simulatedUsage/simulatePastUsageDataset.ts`
  - `modules/usageSimulator/service.ts`
  - `modules/usageSimulator/pastCache.ts`
- Do not recreate simulated intervals from shape/target-day totals in other places.
- Do not create alternate Past baseline compute paths for read/inspect flows.

#### 4) Usage shape profile

- Usage-shape profile interval loading and derivation inputs must use shared modules and shared Chicago semantics.
- Use:
  - `modules/usageShapeProfile/actualIntervals.ts`
  - `modules/usageShapeProfile/derive.ts`
  - `modules/usageShapeProfile/autoBuild.ts`
  - `modules/usageShapeProfile/repo.ts`
- Do not add separate source-choice logic or local date parsing variants.

#### 5) Persisted interval artifacts

- Flows that read/write persisted interval artifacts must use shared artifact modules.
- Use:
  - `lib/usage/intervalSeriesRepo.ts`
  - `lib/usage/resolveIntervalsLayer.ts`
  - `modules/usageSimulator/pastCache.ts`
- Artifact-first read paths must not silently recompute unless action is explicitly rebuild.

#### 6) SMT normalized interval persistence

- All normalized SMT write/replace/persist behavior must go through one module only:
  - `lib/usage/normalizeSmtIntervals.ts`
- Routes may parse/upload/auth/report but must not implement persistence loops or overwrite logic.

#### 7) Monthly stitching / display monthly totals

- Monthly stitching/aggregation must use shared modules.
- Use:
  - `lib/usage/buildUsageBucketsForEstimate.ts`
  - `modules/usageSimulator/dataset.ts`
- Do not create route/tool-specific alternate monthly stitch logic.

#### 8) Admin/debug tools

- Admin/debug routes are not exempt from shared-module rules.
- If a shared module exists, admin/debug routes must use it unless intentionally low-level inspection.
- Any intentional bypass must be clearly labeled low-level inspection/debug only and not used as production/runtime pattern.

#### Required process gate before adding logic

- Before adding new logic, check if shared modules already exist for:
  - date/window logic
  - interval source selection
  - interval fetching
  - simulation/day generation
  - profile derivation inputs
  - cache/artifact reads
  - normalized SMT persistence
  - monthly stitching/aggregation
- If one exists:
  - use it
  - extend it if needed
  - do not duplicate it elsewhere
- If none exists:
  - create a shared module first
  - then call it from routes/services/tools
  - do not bury reusable logic inside a route/page

### Downstream Artifact Boundary Rule

- Current Usage logic remains as-is unless a dedicated Usage change is explicitly approved.
- Past Sim and downstream stages must treat saved artifacts as hard stage boundaries.
- Downstream stages must not repeatedly return to raw usage when a canonical saved artifact already exists for the required stage.

### Stage Boundary Rule

- Usage actual intervals = saved source artifact.
- Past Corrected Baseline = first stitched derived artifact.
- Upgrade Overlay = derived from saved Past Corrected Baseline.
- Future Baseline = derived from saved Past Corrected Baseline plus approved adjustments and overlays.
- Buckets = derived from the saved artifact for that stage, not rebuilt from scratch upstream.

### Test Parity and Speed Rule

- Tests must use the same shared production modules and artifacts.
- Tests are not allowed to recreate alternate business logic paths.
- No test-only duplicate business math for intervals, simulated-day generation, daily/monthly aggregation, overlay math, or bucket math.
- Most tests should be stage-local and artifact-based, with only a small number of full-chain end-to-end tests.

### Not Allowed

- Same function implemented in multiple files.
- Read-time restitching of Past baseline.
- Second monthly overlay pass after stitched Past baseline is saved.
- Admin-only alternate baseline computation for display.
- Test-only duplicate business logic.
- Recomputing whole upstream chains when a saved artifact already exists for the needed stage.

## Implementation Guidelines

### File Organization
- Keep related functionality in modules
- Use consistent naming conventions
- Document public APIs thoroughly
- Maintain backward compatibility
- Keep features isolated by route/module; avoid cross-module coupling
- Keep App Router entry points (e.g., `page.tsx`) thin—move business logic into services/hooks/components
- Avoid reusing global state between subpages unless you expose a clear interface
- Treat core schemas such as `MagicLinkToken`, `User`, `Referral`, and `EnergyUsage` as protected; extend via adjacent tables instead of modifying directly

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

**ESIID Lineage:** Source of truth is ERCOT (daily extract / future Agreement APIs). WattBuy is **not** an ESIID source. UI/CDM treat `esiid` as optional; transformations must not require its presence.

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

### Development Stack & Tooling
- Next.js 14+ App Router with modular route groups
- Prisma ORM (`@prisma/client`) for data access
- Tailwind CSS for styling
- Nodemailer for email-based authentication flows
- Cursor-based AI blocks for code reviews and delivery (follow repo GPT block guidelines)
- Future integrations include WattBuy, Smart Meter Texas (SMT), Zillow, Google Maps, and appliance recognition tooling

## Simulation Invariants

1. Non-excluded actual timestamps are immutable.
2. Simulation is additive/patch-based only.
3. Baseline generation must be deterministic.
4. Weather keys must match canonical day grid (no timezone drift).
5. Past must be fully stable before Future overlay is applied.

### Canonical Past Sim Artifact Rule

- Raw actual usage remains the raw source of truth.
- Past Corrected Baseline is the first canonical derived full-year artifact.
- Past Corrected Baseline must be saved in the existing Past baseline storage.
- Past pages, admin tools, cache restore, diagnostics, and downstream systems must read the saved stitched artifact.
- No read-time re-stitching.
- No second overlay pass on top of the saved Past baseline artifact.
- No alternate rebuild path for the same Past baseline output.