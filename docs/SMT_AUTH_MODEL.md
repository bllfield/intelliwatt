# SMT Authorization Model (IntelliWatt)

Last updated: 2025-11-18

## 1. High-Level UX Flow

This is the canonical SMT authorization flow for IntelliWatt:

1. **User signs in via magic link**  
   - The user must already have a verified email to reach the dashboard.
   - This email is stored in the `User` record and is considered the primary contact.

2. **Customer enters their address** on the landing/entry page using **Google Maps autocomplete**.

3. IntelliWatt **persists the address** into `HouseAddress` (including Google `placeId`, lat/lng, etc.).

4. Backend calls WattBuy using the saved address:
   - Endpoints: `/v3/electricity` and `/v3/electricity/info`
   - Extracts:
     - `ESIID`
     - TDSP/utility information (Oncor, CenterPoint, etc.)

5. IntelliWatt updates `HouseAddress` with:
   - `esiid`
  - `tdspSlug` (TDSP/utility code)
  - `utilityName` and `utilityPhone`
  - `rawGoogleJson` and `rawWattbuyJson`

6. When the customer continues, the site shows an **“SMT Authorization” form** tied to that House/HouseAddress:
   - **Read-only, pre-populated fields (not editable):**
     - Service address (line1/line2/city/state/ZIP) from `HouseAddress`.
     - `ESIID` from `HouseAddress.esiid`.
     - Utility/TDSP from `HouseAddress.tdspSlug` + `HouseAddress.utilityName`.
     - Contact email from the authenticated `User.email` (magic-link email).
   - **Customer-entered fields:**
     - `customerName` (as it appears on the bill).
     - `contactPhone` (optional).
   - **Customer consent:**
     - A single checkbox authorizing IntelliWatt to access SMT data (interval usage and billing history) for **12 months** for the address and ESIID shown.

7. On submit, IntelliWatt creates an `SmtAuthorization` record and:
   - Links it to the authenticated user (`userId`), House, and HouseAddress.
   - Snapshots the service address, ESIID, TDSP data from `HouseAddress`.
   - Snapshots `contactEmail` from the current `User.email`.
   - Sets authorization dates automatically (12-month window).
   - Sets consent flags for interval usage, historical billing, and ongoing subscription.

Later, SMT API calls will use this `SmtAuthorization` record to build compliant SMT payloads.

---

## 2. Logical Data Model — `SmtAuthorization`

The following TypeScript interface is the reference shape used internally. The Prisma model may be a subset, but this interface defines the canonical fields for SMT authorization work.

```ts
export interface SmtAuthorization {
  // Identity / foreign keys
  id: string;
  userId: string;
  houseId: string;
  houseAddressId: string;

  // SMT / meter identity (derived, not typed)
  esiid: string;
  meterNumber?: string | null;

  // Customer-entered values
  customerName: string;

  // Service address snapshot (from HouseAddress)
  serviceAddressLine1: string;
  serviceAddressLine2?: string | null;
  serviceCity: string;
  serviceState: string;
  serviceZip: string;

  // TDSP / Utility (from WattBuy/HouseAddress)
  tdspCode: string;
  tdspName: string;

  // Authorization window (derived)
  authorizationStartDate: string; // "YYYY-MM-DD"
  authorizationEndDate: string;   // "YYYY-MM-DD"

  // Consent flags
  allowIntervalUsage: boolean;
  allowHistoricalBilling: boolean;
  allowSubscription: boolean;

  // Contact info
  contactEmail: string;       // from User.email (magic-link)
  contactPhone?: string | null;

  // Internal SMT identifiers (config/env)
  smtRequestorId: string;
  smtRequestorAuthId: string;

  // Timestamps
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
}
```

Implementation notes:
- `userId` must come from the authenticated session (magic-link).
- `contactEmail` should always match the current `User.email` at time of authorization.
- Address fields, ESIID, and TDSP values should be copied from `HouseAddress` when the authorization is created.
- `smtRequestorId` / `smtRequestorAuthId` may be injected at runtime from env, but are included here for clarity when constructing SMT payloads.

---

## 3. UI Form Fields (Customer-Facing)

### Read-only (derived from HouseAddress and User)
- Service Address Line 1 / 2 / City / State / ZIP
- ESIID
- Utility / TDSP (code + display name)
- Contact Email (from authenticated magic-link user)

### Customer-entered
- Customer Name (as it appears on the bill)
- Contact Phone (optional)
- Authorization checkbox (12-month consent for usage + billing data)

When the checkbox is checked, the backend sets:
- `authorizationStartDate = today`
- `authorizationEndDate = today + 12 months`
- `allowIntervalUsage = true`
- `allowHistoricalBilling = true`
- `allowSubscription = true`

---

## 4. UI → DB → SMT Mapping

### Identity & Address
| UI Label | DB Field | SMT Field |
| --- | --- | --- |
| Service Address Line 1 | `serviceAddressLine1` | `ServiceAddress1` |
| Service Address Line 2 | `serviceAddressLine2` | `ServiceAddress2` |
| City | `serviceCity` | `ServiceCity` |
| State | `serviceState` | `ServiceState` |
| ZIP | `serviceZip` | `ServiceZip` |
| ESIID | `esiid` | `ESIID` |
| Utility / TDSP | `tdspCode`, `tdspName` | `TDSP` / `TDSPCode` |

### Contact
| Source | DB Field | SMT Field |
| --- | --- | --- |
| Authenticated `User.email` | `contactEmail` | `ContactEmail` |
| Customer-entered phone | `contactPhone` | `ContactPhone` |

### Authorization Window & Flags
| Source | DB Fields | SMT Payload |
| --- | --- | --- |
| Consent checkbox | `authorizationStartDate`, `authorizationEndDate`, `allowIntervalUsage`, `allowHistoricalBilling`, `allowSubscription` | `AuthorizationStartDate`, `AuthorizationEndDate`, subscription elements |

### Internal Identifiers
| Source | DB/Config | SMT Field |
| --- | --- | --- |
| Env `SMT_USERNAME` | `smtRequestorId` | `requestorID` |
| Env `SMT_REQUESTOR_AUTH_ID` | `smtRequestorAuthId` | `requesterAuthenticationID` |

The same SMT service ID must be used in three places for every API call:

1. SMT `username` header (JWT service ID)
2. SMT `serviceId` header
3. JSON `requestorID` field inside NewAgreement/NewSubscription

IntelliWatt reads this value from `SMT_USERNAME`.

---

## 5. Validation Rules

- **ESIID:** required, 17 digits (`^\d{17}$`). Prefilled; not editable by customer.
- **Customer Name:** required, trimmed, length > 0.
- **Address fields:** required, copied from HouseAddress; state must be `TX`, ZIP must be 5 digits.
- **Authorization dates:** set automatically; `authorizationEndDate` must be ≥ start date (default +12 months).
- **Contact Email:** required (from `User.email`).
- **Contact Phone:** optional; normalize if provided.
- **Consent checkbox:** required; submission blocked if unchecked.

---

## 6. Implementation Status

This doc defines the spec:
- ✅ `SmtAuthorization` interface at `types/smt.ts`
- ✅ UX field list and mapping (address/ESIID prefilled, email from magic-link)
- ✅ Validation guidance
- ✅ Relationship to `User`, `House`, `HouseAddress`

Next steps (separate implementation tasks):
1. Add a Prisma model reflecting this interface.
2. Implement SMT Authorization form + API route to create/read records.
3. Wire SMT REST calls to consume `SmtAuthorization` data when building SMT payloads.

