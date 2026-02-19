/**
 * Legacy path compatibility shim.
 *
 * This repository uses the root `app/` App Router (not `src/app`) for production routes.
 * To avoid ambiguity (and accidental edits), this file re-exports the active implementation.
 *
 * Active route: `app/api/address/save/route.ts`
 */
export { POST, dynamic } from "@/app/api/address/save/route";
