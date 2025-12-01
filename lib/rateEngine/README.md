# Rate Engine Core

This directory contains pure calculation logic for upcoming plan analysis work.

- `planCost.ts` exports strongly typed helpers that take **normalized inputs only** (plain objects describing usage and plan components).
- There is **no Prisma, no database access, and no framework coupling** here. Keep it that way—any future additions should remain side‑effect free and focus on deterministic math.
- Higher-level services, routes, or jobs can import `calculatePlanCostForUsage()` and feed it:
  - Summed SMT/usage data (from the master DB or module DBs).
  - WattBuy offers or internally curated plans.
  - Normalized current plan details.

Downstream wiring (API endpoints, Prisma queries, etc.) will live elsewhere—this folder should remain a small, testable, TypeScript-only rate engine core.

