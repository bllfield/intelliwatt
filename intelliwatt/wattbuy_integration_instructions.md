# WattBuy Integration Instructions for IntelliWatt

_Last updated: July 3, 2025_

---

## ✅ Overview

WattBuy offers a fully compliant retail electricity enrollment API. IntelliWatt will be integrating this to enable customer switching via either API or fallback methods. This file includes:

- Required UX disclosures
- API flow structure
- Testing guidelines
- Plan presentation rules
- Notes from WattBuy's team (Greg)

---

## ✅ Contract Status

- Contract draft provided by WattBuy
- Structured for full API integration (commission model differs from referral mode)
- Can be amended later if fallback model is used
- Yellow-highlighted fields in contract must be completed before return

---

## ✅ API Access

- API access granted
- Current limit: **50 calls/second, 5,000/day**
- Endpoint documentation: (link was provided separately)

---

## ✅ Enrollment Flow Summary

1. **User selects a plan**
2. **Call `GET /form_fields` endpoint**
   - This returns all fields required for that specific plan (some vary by supplier)
3. **Dynamically render UX input fields**
   - Collect user responses for all required items (some plans require additional items like “preferred communication method”)
4. **Show all required disclosures and terms (see below)**
5. **Submit enrollment via `POST /order_submission` endpoint**
6. **Use test email addresses during testing** (provided by WattBuy)

---

## ✅ Testing Protocol

- Can use **any address** as long as a **designated test email** from WattBuy is used
- Prevents actual enrollments during development
- Do **not submit production orders** without notifying WattBuy

---

## ✅ UX & Legal Requirements (Plan Display)

When displaying any plan to users, the following must be included:

- ✅ Supplier Name (e.g., Constellation)
- ✅ Supplier PUCT registration number
- ✅ Supplier contact email & phone
- ✅ Distributor name (e.g., Oncor, TNMP)
- ✅ Plan Name
- ✅ Plan Term/Length
- ✅ All pricing details or tiers (not just estimated monthly cost)
- ✅ Cancellation Fee (if applicable)
- ✅ Live links to:
  - Terms of Service
  - Electricity Facts Label (EFL)
  - Your Rights as a Customer

---

## ✅ UX & Legal Requirements (Enrollment)

- If credit check is required:
  - Show this language before collecting SSN:
    > You understand that by clicking on [Next, Continue, etc.] immediately following this notice, you are providing 'written instructions' to [Supplier] under the Fair Credit Reporting Act authorizing [Supplier] to obtain information from your personal credit report or other information from a credit agency. You authorize [Supplier] to obtain such information solely to determine if a deposit is required.

- You may **not** store Social Security Numbers in any form.

- During checkout, you must display:
  > You have the right to review and rescind the terms of service, without penalty, within three federal business days of receipt, as explained in the terms of service.

  > Your service will be switched from your current provider to [Supplier]. Please do not disconnect service with your current supplier.

- Before final submit, the user must check a box affirming:
  > By checking this box, I agree to establish [Supplier] as my retail electric provider, and I agree to the Terms of Service [linked], Electricity Facts Label [linked], and Your Rights as a Customer [linked] documents associated with my plan. I also authorize [Supplier] to switch, establish, or change my service.

---

## ✅ Dynamic Field Handling

- Use `GET /form_fields` to dynamically build your UX per plan
- Each plan may require different input fields
- Example: Direct Energy requires a “preferred communication method” field

---

## ✅ Plan Availability Handling

- WattBuy does **not** maintain a static list of covered zip codes
- If a valid address returns no `offer_category = electricity_plans`, assume no coverage
- UX should gracefully handle this case:
  - Suggest alternate products (smart thermostats, solar, etc.)
  - Or display a message that no plans are available

---

## ✅ Current Questions to Address

(Add any questions for WattBuy here as they arise.)

---

## ✅ Contact

- Greg @ WattBuy
- Use his direct email for questions
