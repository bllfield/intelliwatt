# Database Connections and Pooling

## Web App (Vercel)
- Uses `DATABASE_URL` pointing at the DO connection pool (PgBouncer) for the main app DB.
- Prisma clients inside Next.js API/routes/pages should keep using this pooled URL.

## Background Jobs / Droplet Services
- SMT ingest and normalize on the droplet use a **direct Postgres URL** (no PgBouncer) to the same app database.
- Examples: `deploy/smt/fetch_and_post.sh`, `smt-upload-server`, inline normalize jobs.

## Why direct for ingest?
- Ingest jobs open a small number of long-lived connections and can run heavier queries; direct connections avoid pool limits and simplify debugging.

## What NOT to change
- Do **not** switch SMT ingest/normalize to a pooled URL unless you intentionally redesign the architecture.
- Do **not** repoint `DATABASE_URL` to a different database than ingest uses without planning data migration.
