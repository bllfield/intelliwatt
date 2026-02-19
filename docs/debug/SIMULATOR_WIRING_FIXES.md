## Simulator Wiring Fixes (No Feature Logic)

**Date**: 2026-02-19  
**Scope**: wiring + persistence + error surfacing only (no curve math / plan engine / SMT JWT changes)

### Address save: persist WattBuy raw payload for home prefill

- **File**: `app/api/address/save/route.ts`
- **Change**: when we already call `resolveAddressToEsiid(...)` (WattBuy-backed), we now **persist the returned raw payload** into `HouseAddress.rawWattbuyJson` **only when missing** (or when the client explicitly provided `wattbuyJson`).
- **Why**: `GET /api/user/home-profile/prefill` reads `HouseAddress.rawWattbuyJson`, but the main UI (`QuickAddressEntry`) does not send `wattbuyJson`, so prefill often had no data.
- **Constraint honored**: **no new WattBuy calls** were added; we only store the payload we already fetched during ESIID resolution.

### Duplicate route ambiguity: `/app` vs `/src/app` address save

- **File**: `src/app/api/address/save/route.ts`
- **Change**: replaced the duplicate implementation with a **thin re-export shim**:
  - `export { POST, dynamic } from "@/app/api/address/save/route";`
- **Why**: prevent accidental edits to a non-active legacy path; keep behavior identical if `src/app` routing is ever enabled.

### Simulator requirements: additive `dbStatus` for module DB wiring

- **File**: `app/api/user/simulator/requirements/route.ts`
- **Change**: response now includes **non-breaking**:
  - `dbStatus: { homeDetails, appliances, usage }` where each is `"ok" | "missing_env" | "unreachable" | "error"`.
- **Why**: previously, the simulator couldn’t distinguish “no profile saved yet” vs “module DB missing/unreachable”, leading to confusing UX and generic errors.

### Simulator UI: surface wiring/env errors inline

- **File**: `components/usage/UsageSimulatorClient.tsx`
- **Change**:
  - reads `dbStatus` from requirements response
  - shows an inline “Wiring / configuration” banner with exact status strings
  - disables “Open Home” / “Open Appliances” buttons when their backing module DB is not `"ok"`
- **Why**: prevents silent failures and makes missing env/unreachable DB issues obvious.

### Home modal: friendly error message on load (not just save)

- **File**: `components/home/HomeDetailsClient.tsx`
- **Change**: maps load-time API errors through `friendlyErrorMessage(...)` so typed 503 codes render as human-readable text.

### Green Button refresh: handle `admin_token_missing` gracefully

- **File**: `components/dashboard/GreenButtonUtilitiesCard.tsx`
- **Change**: when `POST /api/user/usage/refresh` fails with `{ error: "admin_token_missing" }`, the UI now shows:
  - “Upload complete. Usage refresh is pending because ADMIN_TOKEN is not configured in this environment.”
- **Why**: upload can still succeed via droplet; refresh may be blocked in preview/dev by missing `ADMIN_TOKEN`. This should not look like an upload failure.

