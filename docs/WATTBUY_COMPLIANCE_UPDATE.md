# WattBuy Compliance Update - January 2025

## Overview

WattBuy requires that all plan presentations include specific supplier and distributor information to maintain compliance with regulatory requirements in Texas.

> Note: We now use WattBuy's **Retail Rates** database (`/v3/electricity/retail-rates`), **Electricity** catalog (`/v3/electricity`), and **Electricity Info** (`/v3/electricity/info`) for plan intelligence. `/v3/offers` is retired in our stack. API keys remain server-only; admin routes are token-gated.

**Current Implementation:**
- Uses `x-api-key` header (not Authorization Bearer) per WattBuy test page spec.
- Parameters: `utilityID` (camelCase), `state` (lowercase, e.g., `tx`).
- Auto-derives `utilityID` from address via `/v3/electricity/info` when not provided.
- Includes retry logic (1 retry on 5xx errors) and diagnostic header capture.
- Endpoints: `/api/admin/wattbuy/retail-rates-test`, `/api/admin/wattbuy/retail-rates-zip`, `/api/admin/wattbuy/retail-rates-by-address`.

## Required Compliance Fields

When displaying any electricity plan to users, the following information must be prominently displayed:

### Supplier Information
- **Supplier Name** (e.g., "Constellation Energy")
- **Supplier PUCT Registration Number** (e.g., "REP-123456")
- **Supplier Contact Email** (for customer inquiries)
- **Supplier Contact Phone Number** (for customer service)

### Distributor/TDSP Information
- **Distributor Name** (e.g., "Oncor", "CenterPoint", "TNMP")
- The TDSP (Transmission and Distribution Service Provider) that delivers electricity to the customer's address

### Plan Details
- **Plan Name** (already displayed)
- **Plan Term/Length** (already displayed, e.g., "12 months")
- **Pricing details** (already displayed via tier breakdown)
- **Cancellation Fee** (already displayed)

### Document Links
- **EFL (Electricity Facts Label)** link (already displayed)
- **Terms of Service** link (already displayed)
- **YRAC (Your Rights as a Customer)** link (already displayed)

## Current Status

### ✅ Already Implemented
- Supplier Name (displayed in plan header)
- Distributor/TDSP Name (included in plan metadata)
- Plan Name, Term, Pricing Details
- Cancellation Fee
- EFL, TOS, YRAC links

### ⚠️ Needs Implementation
The following compliance fields need to be added to the plan display:

1. **Supplier PUCT Registration Number** - Extract from WattBuy API response
2. **Supplier Contact Email** - Extract from WattBuy API response
3. **Supplier Contact Phone** - Extract from WattBuy API response
4. **Distributor Name** - Currently only TDSP slug is stored; need full name

## API Response Mapping

Based on WattBuy API documentation, these fields may be available in:
- `offer_data.supplier_registration_number` or `offer_data.puct_registration_number`
- `offer_data.supplier_contact_email` or `offer_data.contact_email`
- `offer_data.supplier_contact_phone` or `offer_data.contact_phone`
- `offer_data.utility_name` for full distributor name (currently only utility slug is used)

Note: If these fields are not present in the WattBuy API response, display "Not provided by supplier" in gray text.

## Implementation Requirements

1. Update `lib/wattbuy/normalize.ts` to extract compliance fields from raw offer data
2. Update `components/plan/PlanCard.tsx` to display these fields in the plan details section
3. Add fallback handling for missing compliance data
4. Ensure compliance fields appear alongside existing plan information
5. Maintain all existing functionality and layouts

## Fallback Strategy

If compliance fields are not available in the API response:
1. Display "Not provided by supplier" in gray text for each missing field
2. Add a note that users can obtain this information by contacting the supplier directly
3. Do not block plan enrollment due to missing compliance data (this is supplier data issue)

## Legal Context

According to WattBuy's integration requirements and Texas PUCT regulations, plan presentations must include sufficient supplier identification information to allow customers to:
- Contact the supplier directly with questions
- Verify supplier credentials with the PUCT
- Make informed decisions about their electricity provider

## Next Steps

1. Verify WattBuy API response structure for compliance fields
2. Update data normalization layer to extract these fields
3. Update UI components to display compliance information
4. Test with real WattBuy API responses
5. Document any gaps in WattBuy API data

## Related Files

- `lib/wattbuy/normalize.ts` - Normalize offer data
- `lib/wattbuy/client.ts` - WattBuy API client
- `components/plan/PlanCard.tsx` - Plan display component
- `app/api/offers/route.ts` - Offers API endpoint

## References

- WattBuy Integration Instructions: `intelliwatt/wattbuy_integration_instructions.md`
- Sample API Payloads: `intelliwatt/wattbuy_integration/sample_api_payloads.json`

