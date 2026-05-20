# Database Connections and Pooling

## Web App (Vercel)
- Uses `DATABASE_URL` pointing at the DO connection pool (PgBouncer) for the main app DB.
- Also uses separate Prisma datasources (`USAGE_DATABASE_URL`, `HOME_DETAILS_DATABASE_URL`, etc.) — **each opens its own connection pool slot per request**.
- Prisma clients in `lib/db.ts` and `lib/db/*Client.ts` are **singletons per serverless instance** (`globalThis`) so one lambda does not spawn duplicate clients for the same datasource.
- **`connection_limit` in the URL:** if both `DATABASE_URL` and `USAGE_DATABASE_URL` are set with `connection_limit=1`, a single route that touches main + usage DB needs **two** slots at once and will starve the pool (`P2024`). Use **`connection_limit=2` or higher** on each pooled URL, or keep heavy post-ingest deferred (see `lib/db/connectionPoolBudget.ts`).
- **SMT raw-upload `postIngest`:** bucket rebuild + plan pipeline are **queued** by default (not run inline). `/api/admin/smt/cron/post-ingest` drains the queue with a 60s+ per-task budget. Pass `inlinePostIngest: true` only for explicit admin debugging.

## Background Jobs / Droplet Services
- SMT ingest and normalize on the droplet use a **direct Postgres URL** (no PgBouncer) to the same app database.
- Examples: `deploy/smt/fetch_and_post.sh`, `smt-upload-server`, inline normalize jobs.

## Why direct for ingest?
- Ingest jobs open a small number of long-lived connections and can run heavier queries; direct connections avoid pool limits and simplify debugging.

## What NOT to change
- Do **not** switch SMT ingest/normalize to a pooled URL unless you intentionally redesign the architecture.
- Do **not** repoint `DATABASE_URL` to a different database than ingest uses without planning data migration.
