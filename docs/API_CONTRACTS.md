# API Contracts (v1)

## Response Stability

### Breaking Changes Policy
- **Responses are stable** - breaking changes require v2
- **Additive changes only** in v1 (new fields, optional parameters)
- **Deprecation timeline** for removed fields (6+ months notice)
- **Version negotiation** via Accept header or URL path

### Version Lifecycle
- **v1**: Current stable version
- **v2**: Next major version (breaking changes)
- **Deprecated**: 6-month sunset period
- **Removed**: No longer supported

## Example Contract: House Profile

### Endpoint
```
GET /api/v1/houses/{id}/profile
```

### Response Format
```json
{
  "id": "addr_uuid",
  "line1": "123 Main St",
  "line2": "Apt 4B",
  "city": "Fort Worth",
  "state": "TX",
  "zip5": "76107",
  "zip4": "1234",
  "country": "US",
  "lat": 32.75,
  "lng": -97.35,
  "validated": true,
  "esiid": "1044372...",
  "tdsp": "oncor",
  "utility": {
    "name": "Oncor",
    "phone": "1-888-313-4747"
  },
  "createdAt": "2025-01-15T10:30:00Z",
  "updatedAt": "2025-01-15T10:30:00Z"
}
```

### Field Specifications

#### Required Fields
- **`id`**: Unique address identifier (UUID)
- **`line1`**: Street address (string, non-empty)
- **`city`**: City name (string, non-empty)
- **`state`**: State abbreviation (string, 2 characters)
- **`zip5`**: ZIP code (string, 5 digits)
- **`country`**: Country code (string, default "US")
- **`validated`**: Address validation status (boolean)

#### Optional Fields
- **`line2`**: Apartment/suite number (string, nullable)
- **`zip4`**: ZIP+4 extension (string, 4 digits, nullable)
- **`lat`**: Latitude (number, nullable)
- **`lng`**: Longitude (number, nullable)
- **`esiid`**: Electric Service Identifier (string, nullable)
- **`tdsp`**: TDSP slug (string, nullable)

#### Nested Objects
- **`utility`**: Utility company information
  - **`name`**: Company name (string, nullable)
  - **`phone`**: Contact phone (string, nullable)

#### Timestamps
- **`createdAt`**: ISO 8601 timestamp (string)
- **`updatedAt`**: ISO 8601 timestamp (string)

## Error Response Format

### Standard Error Structure
```json
{
  "error": "Error message",
  "errorClass": "VALIDATION",
  "corrId": "uuid-string",
  "details": {
    "field": "email",
    "message": "Invalid email format"
  }
}
```

### Error Classes
- **`VALIDATION`**: Input validation failures
- **`NETWORK`**: External API connectivity issues
- **`DATABASE`**: Database connection or query errors
- **`AUTHENTICATION`**: User authentication failures
- **`AUTHORIZATION`**: Permission/access control issues
- **`BUSINESS_LOGIC`**: Application-specific errors
- **`UNKNOWN`**: Unclassified errors

## Data Model Reference

### HouseAddress Model
The API response maps to the `HouseAddress` Prisma model:

```prisma
model HouseAddress {
  id                    String   @id @default(uuid())
  userId                String
  houseId               String?
  
  addressLine1          String
  addressLine2          String?
  addressCity           String
  addressState          String
  addressZip5           String
  addressZip4           String?
  addressCountry        String   @default("US")
  
  placeId               String?
  lat                   Float?
  lng                   Float?
  
  addressValidated      Boolean  @default(false)
  validationSource      ValidationSource @default(NONE)
  
  esiid                 String?  @unique
  tdspSlug              String?
  utilityName           String?
  utilityPhone          String?
  
  smartMeterConsent     Boolean  @default(false)
  smartMeterConsentDate DateTime?
  
  rawGoogleJson         Json?
  rawWattbuyJson        Json?
  
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}
```

## Current Plan Manual Entry – Rate Structure Contract

### Rate Structure Object
Manual current plan entries and the internal rate comparison engine share a unified `rateStructure` payload. All rate structures must include a `type` field whose value is a `RateType` enum aligned with the database (`FIXED`, `VARIABLE`, `TIME_OF_USE`). Downstream systems rely on this shape for automated costing—no human interpretation required.

```ts
type RateType = 'FIXED' | 'VARIABLE' | 'TIME_OF_USE'

interface TimeOfUseTier {
  label: string                     // e.g. "Free Nights", "Peak", "Off-Peak"
  priceCents: number                // ¢/kWh for this tier (0 allowed for "free")
  startTime: string                 // "HH:MM" 24h, local time (e.g. "21:00")
  endTime: string                   // "HH:MM" 24h (e.g. "06:00")
  daysOfWeek: ('MON'|'TUE'|'WED'|'THU'|'FRI'|'SAT'|'SUN')[] | 'ALL'
  monthsOfYear?: number[]           // [1..12] when seasonal; omit for all-year tiers
}

interface BaseRateStructure {
  type: RateType
  baseMonthlyFeeCents?: number
  // Optional bill credits applied at the bill level.
  billCredits?: BillCreditStructure | null
}

interface FixedRateStructure extends BaseRateStructure {
  type: 'FIXED'
  energyRateCents: number          // flat ¢/kWh for all hours
}

interface VariableRateStructure extends BaseRateStructure {
  type: 'VARIABLE'
  currentBillEnergyRateCents: number   // ¢/kWh for the most recent bill
  indexType?: 'ERCOT' | 'FUEL' | 'OTHER'  // optional classifier to match EFL/rate engine
  variableNotes?: string                 // optional, display-only descriptor
}

interface TimeOfUseRateStructure extends BaseRateStructure {
  type: 'TIME_OF_USE'
  tiers: TimeOfUseTier[]
}

type RateStructure =
  | FixedRateStructure
  | VariableRateStructure
  | TimeOfUseRateStructure
```

- `RateType` must stay in sync with the Prisma enum used for persisted plans.
- `RateStructure` is machine-usable: the rate engine can simulate hourly or interval costs from this data without manual intervention.
- `variableNotes` is for presentation only; pricing logic depends on `currentBillEnergyRateCents` and `indexType`.

### Bill Credit Structure

```ts
// Applies to typical Texas “bill credit” plans where you get a fixed
// dollar credit when your monthly usage falls within a kWh range.
interface BillCreditRule {
  label: string
  creditAmountCents: number          // positive value, e.g. 10000 = $100 credit

  // Monthly kWh usage range where this credit applies.
  minUsageKWh: number                // inclusive lower bound, e.g. 1000
  maxUsageKWh?: number               // optional upper bound, e.g. 2000; if omitted = no upper limit

  // Optional seasonality. If omitted, credit applies all year.
  monthsOfYear?: number[]            // 1..12 for Jan..Dec
}

interface BillCreditStructure {
  hasBillCredit: boolean
  rules: BillCreditRule[]
}
```

Bill credits are modeled as one or more `BillCreditRule` entries. Each rule describes a flat credit amount (in cents), the monthly usage range where it applies, and optional seasonal months. The rate engine can simulate any month’s bill, determine which rules apply based on kWh usage, and subtract the credit amount from the total. This mirrors common TX EFL language such as “$100 bill credit when usage is between 1000 and 2000 kWh.”

### Manual Entry UI Expectations
- **Step 1 — Plan type selection:** `Fixed rate`, `Variable / Indexed rate`, or `Time-of-Use (different rates by time of day)`.
- **Step 2 — Type-specific inputs:**
  - **Fixed:** Provider, Plan Name (existing fields), Flat Energy Rate (¢/kWh), optional Base Monthly Fee → produces `type: 'FIXED'`.
  - **Variable / Indexed:** Provider, Plan Name, Current bill effective energy rate (¢/kWh), optional Base Monthly Fee, Index Type select (`ERCOT`, `Fuel`, `Other`), optional notes → produces `type: 'VARIABLE'`.
  - **Time-of-Use:** Provider, Plan Name, optional Base Monthly Fee, plus dynamic tiers (label, price, start time, end time, days of week with "All days" helper, optional months Jan–Dec) with add/remove controls → produces `type: 'TIME_OF_USE'` with `tiers`.

#### Manual Entry – Bill Credits
- Add a **“Bill credits (if applicable)”** section beneath the manual entry fields.
- UI elements:
  - Toggle/checkbox: “This plan includes bill credits.”
  - When enabled, show one or more **Bill Credit** blocks (Bill Credit 1, Bill Credit 2, …) with:
    - Credit label (text, e.g., “$100 credit at 1000–2000 kWh”)
    - Credit amount ($)
    - Minimum monthly usage (kWh)
    - Maximum monthly usage (kWh, optional if no cap)
    - Months (optional checkboxes Jan–Dec with an “All months” helper)
  - Button: “+ Add another bill credit” to append additional rules.
- Submitted data must map to:
  ```ts
  billCredits: {
    hasBillCredit: boolean
    rules: BillCreditRule[]
  }
  ```
  Example input — $100 credit between 1000 and 2000 kWh for all months — becomes:
  ```json
  {
    "hasBillCredit": true,
    "rules": [
      {
        "label": "User-entered label",
        "creditAmountCents": 10000,
        "minUsageKWh": 1000,
        "maxUsageKWh": 2000,
        "monthsOfYear": null
      }
    ]
  }
  ```

### Shared Rate Engine Contract
- The rate comparison engine ingests the same `RateStructure` shape for manual current plans and normalized vendor offers.
- Normalizing all sources to this contract keeps comparison logic consistent between a user’s current plan and third-party plans surfaced in IntelliWatt recommendations.
- When simulating monthly bills, the engine evaluates `billCredits.rules`, applies credits where `minUsageKWh <= usage < maxUsageKWh` (or no max), and subtracts the credit amount from that month’s total—uniformly across fixed, variable, and TOU plans because the data hangs off `BaseRateStructure`.

## Validation Rules

### Address Validation
- **Required fields**: line1, city, state, zip5
- **State format**: 2-character uppercase (TX, CA, etc.)
- **ZIP format**: 5 digits for zip5, 4 digits for zip4
- **Coordinates**: Valid latitude (-90 to 90), longitude (-180 to 180)

### ESIID Validation
- **Format**: Alphanumeric string
- **Length**: Variable (typically 10-20 characters)
- **Uniqueness**: Must be unique across all addresses

### Utility Information
- **Name**: Non-empty string if provided
- **Phone**: Valid phone number format if provided

## Rate Limiting

### Limits
- **Per IP**: 100 requests per minute
- **Per User**: 1000 requests per hour
- **Burst**: Allow 10 requests per second

### Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

## Caching

### Cache Headers
- **ETag**: For conditional requests
- **Cache-Control**: `max-age=300` (5 minutes)
- **Vary**: `Accept, Authorization`

### Cache Invalidation
- **On update**: Invalidate by address ID
- **On delete**: Remove from cache
- **TTL**: Automatic expiration after 5 minutes
