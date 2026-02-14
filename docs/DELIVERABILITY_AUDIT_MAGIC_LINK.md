## Deliverability Audit — Magic-Link Email (IntelliWatt / HitTheJackWatt)

Status: **Audit-only** (no production changes made in this step).  
Scope: **Magic-link email system end-to-end** (token creation/storage → email send → template/link → login consumption).

This report is based on repository evidence in:
- Sender routes: `app/api/send-magic-link/route.ts`, `app/api/send-admin-magic-link/route.ts`, `app/api/external/magic-link/route.ts`
- Email sender: `lib/email/sendLoginEmail.ts`
- Token helper: `lib/magic/magic-token.ts`
- Login consumption: `app/login/magic/route.ts`
- DB model: `prisma/schema.prisma` (`MagicLinkToken`)

---

## A) Current implementation summary (facts only)

### What triggers the email (route name, params)

1) **Customer magic-link send**
- **Route**: `POST /api/send-magic-link` (`app/api/send-magic-link/route.ts`)
- **Body**:
  - `email` (required)
  - `referralCode` (optional string; appended to link as query param `ref`)
- **Behavior**:
  - Normalizes email via `normalizeEmail()` (lowercase + trim)
  - Creates token via `createMagicToken()` (`crypto.randomBytes(32).toString('hex')`)
  - Stores token row via `storeToken()` (Prisma create)
  - Builds link to `/login/magic?token=...` and optionally `&ref=...`
  - Calls `sendLoginEmail(normalizedEmail, magicLink)`
  - Returns `{ success: true }` even if email send fails (errors are logged/swallowed)
  - Logs the full magic link to server logs (“MAGIC LINK FOR TESTING”)
  - If DB write fails, generates a `temp_...` token and still logs/sends that link

2) **Admin magic-link send**
- **Route**: `POST /api/send-admin-magic-link` (`app/api/send-admin-magic-link/route.ts`)
- **Body**: `{ email }`
- **Authorization**: hardcoded allowlist `ADMIN_EMAILS` (must match normalized email)
- **Link**: `${baseUrl}/admin/magic?token=${token}` (baseUrl resolution below)
- **Email**: `sendLoginEmail(normalizedEmail, magicLink, 'Admin Access to IntelliWatt')`
- **Logging**: logs the full admin link to server logs
- If DB write fails, generates a `temp_admin_...` token and still logs/sends that link

3) **External magic-link send (CORS-enabled for HitTheJackWatt origins)**
- **Route**: `POST /api/external/magic-link` (`app/api/external/magic-link/route.ts`)
- **Body**: `{ email, zip, source = 'external', referralToken }`
- **Link**: `/login/magic?token=...` plus optional `&ref=...`
- **Email subject**:
  - `source === 'hitthejackwatt'` → `Your HitTheJackWatt Magic Link`
  - else → `Welcome to IntelliWatt - Access Your Dashboard`
- **CORS**: allows `Origin` of `https://bllfield.github.io`, `https://hitthejackwatt.com`, `https://www.hitthejackwatt.com`
- **Response**: includes `magicLink` in JSON “for testing purposes”

### What provider/transport is used (SMTP host, port, nodemailer config style)

- **Library**: Nodemailer (`lib/email/sendLoginEmail.ts`)
- **Transport type**: **raw SMTP** (not an ESP API)
- **Config**:
  - `host`: `process.env.EMAIL_HOST`
  - `port`: `Number(process.env.EMAIL_PORT)`
  - `secure`: `process.env.EMAIL_PORT === '465'` (SMTPS only when the string is exactly `"465"`)
  - `auth.user`: `process.env.EMAIL_USER`
  - `auth.pass`: `process.env.EMAIL_PASS`
- **Send gating**: `sendLoginEmail()` only attempts SMTP send when `EMAIL_HOST`, `EMAIL_USER`, and `EMAIL_PASS` are set.

### What “From” address is used (exact value and where it comes from)

- **From email**: `process.env.EMAIL_USER` (also used as SMTP auth user)
- **From header**: `"${fromName}" <${fromEmail}>`
  - **Admin-ish** (subject contains `"Admin"`) → `fromName = "IntelliWatt Admin"`
  - **Non-admin** → `fromName = "HitTheJackWatt • Powered by IntelliWatt"`

### What domain the magic link points to (how baseUrl is resolved in prod vs preview)

All three sender routes build `baseUrl` as:

- `process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? https://$VERCEL_URL : https://intelliwatt.com)`

Implications:
- **Production (if `NEXT_PUBLIC_BASE_URL` is set)**: links point to that configured domain (expected `https://intelliwatt.com`)
- **Preview (if `NEXT_PUBLIC_BASE_URL` is unset)**: links point to the preview hostname `https://<hash>.vercel.app` via `VERCEL_URL`
- **Fallback**: `https://intelliwatt.com`

The HTML email also embeds images from the same base URL (logo URLs are constructed from `NEXT_PUBLIC_BASE_URL` / `VERCEL_URL` / fallback), so recipients will load images from that same resolved domain.

### Token TTL, storage, and whether links can be reused

- **Token model**: `MagicLinkToken` in `prisma/schema.prisma`
  - Fields include: `email`, `token` (unique), `expiresAt`, `used` (default false), optional `referralToken`
- **Token TTL**: 15 minutes
  - Implemented in `storeToken()` (`lib/magic/magic-token.ts`): `expiresAt = now + 15 min`
- **Token consumption**: `GET /login/magic?token=...` (`app/login/magic/route.ts`)
  - Rejects if missing, not found, `used=true`, or now > `expiresAt`
  - Marks token `used=true` on successful login
  - Sets cookie `intelliwatt_user=<normalizedEmail>` (httpOnly, `secure` in production, 7-day maxAge)
- **Reuse**: single-use after successful redemption
- **Cleanup**: no cleanup job found in repo for expired/used `MagicLinkToken` rows (rows accumulate)

---

## B) Deliverability risk checklist (code + config inferred)

This section is inferred from code. DNS/provider status is **not** verifiable from this repo and must be checked externally.

### 1) Is SPF configured for the sending domain?

- **Unknown from repo.**
- **Which domain to check**: the domain portion of the RFC5322 From address, i.e. the domain in `EMAIL_USER` (because `From: <EMAIL_USER>`).
- **How to verify**: DNS TXT lookup for SPF on that From-domain (often at root `@`), confirm it authorizes the actual SMTP service behind `EMAIL_HOST`.

### 2) Is DKIM being used by the sending service?

- **Unknown from repo.** DKIM signing is performed by the SMTP provider; Nodemailer here does not DKIM-sign.
- **How to verify**: send a message and inspect headers for `DKIM-Signature:`; confirm `d=` aligns with the From-domain (organizational alignment is usually “good enough”).

### 3) Is DMARC present + aligned with From domain?

- **Unknown from repo.**
- **Alignment requirement**: DMARC evaluates alignment against the RFC5322 From-domain. For “passes”, at least one of SPF or DKIM should align with that From-domain.
- **How to verify**: DNS TXT lookup at `_dmarc.<from-domain>`.

### 4) Is the From domain consistent with the return-path / envelope-from?

- **Not determinable from code alone.**
- The code does not set `envelope` in Nodemailer; envelope-from/return-path is chosen by the SMTP server/provider defaults.
- **How to verify**: inspect delivered message headers for `Return-Path:` and compare domain to From-domain.

### 5) Are we missing plain-text part (multipart/alternative)?

- **No**: `sendLoginEmail()` sets both `text` and `html`.

### 6) Are we using link shorteners or suspicious CTA-only copy?

- **No link shorteners** (links are direct to your resolved base URL).
- **Risk signal present**: the non-admin email is strongly CTA-forward and uses “magic link / secure link” language; some filters weight that pattern as phishing-adjacent, especially when combined with mixed branding and a button-centric layout.

### 7) Do we set List-Unsubscribe (not required for transactional, but note if present)?

- **No**: no `List-Unsubscribe` header is set.

### 8) Are there “spammy” keywords/structures in subject/body?

Evidence-based risk signals in current copy:
- Subjects include “Magic Link” / “Access”
- Body uses “secure link” + “magic link”
- Non-admin From name: `HitTheJackWatt • Powered by IntelliWatt` (brand mashup + special character bullet)
- HTML uses a prominent neon-green button + two images (could resemble marketing/phishing layouts)

### 9) Are we sending from a domain that’s also used for general email (reputation risk)?

- **Unknown from repo** because we cannot see what `EMAIL_USER` is in production.
- If `EMAIL_USER` is a human mailbox (e.g., `support@...`) and also used for day-to-day mail, you risk mixing different mail streams (transactional auth vs. human correspondence) under one identity/reputation.

### 10) Are preview deploys sending emails from the same domain and affecting reputation?

- **Potential risk is present by design**:
  - Link host can become `https://<hash>.vercel.app` if `NEXT_PUBLIC_BASE_URL` is unset and `VERCEL_URL` is set.
  - If preview environments also have `EMAIL_*` set and send to real recipients, those recipients see `*.vercel.app` links, which can increase spam reports and harm sender reputation even if prod DNS is correct.
- Whether preview actually sends depends on Vercel env variable scoping (not visible in repo).

Additional non-DNS risks worth calling out (repo evidence):
- **Magic links are logged** (full URLs) in multiple server routes and in `sendLoginEmail()` (high-risk operationally; also increases chance links get copied/forwarded, which increases “phishing” perception).
- **External endpoint returns `magicLink` in API response** (could be abused; also increases chance of link leakage).

---

## C) What I need to know — QUESTIONS (only what cannot be determined from repo/config)

### DNS/Auth (SPF/DKIM/DMARC status, who manages DNS)
- Who manages DNS for the From-domain (domain portion of `EMAIL_USER`)?
- What is the current SPF record for that domain, and does it authorize the SMTP service behind `EMAIL_HOST`?
- Are DKIM keys configured for that domain with the sending provider? What is the DKIM `d=` domain and selector(s)?
- Is DMARC present at `_dmarc.<from-domain>`? If yes:
  - policy (`p=`) and alignment (`adkim`, `aspf`)
  - where are aggregate reports (`rua=`) going, and are they monitored?

### Sending provider details (Gmail SMTP? Office365? SES? Postmark? etc.)
- What are the production values for `EMAIL_HOST`, `EMAIL_PORT`, and (critically) what provider is that host?
- Does that provider support DKIM signing for your domain on SMTP sends, and how is return-path handled?
- Is the sending identity a dedicated transactional mailbox/subdomain, or a shared corporate mailbox?

### Volume / patterns (emails/day, bounce rate, user complaints)
- Rough login emails/day and peak burst rate.
- Which inbox providers are seeing spam placement (Gmail/Yahoo/Outlook/iCloud)?
- Any complaint rate / “marked as spam” feedback from the provider?
- Are you seeing hard bounces, or are emails delivered but landing in spam/promotions?

### From address decisions (login@ vs noreply@; subdomain plan)
- What should the canonical From address be for auth mail (e.g., `login@intelliwatt.com` vs `noreply@...`)?
- Should `Reply-To` route to support, or be disabled?
- Should HitTheJackWatt mail use a distinct From-domain/subdomain from IntelliWatt to avoid brand-mismatch signals?

### Whether we can switch providers this week
- Are you willing/able to move transactional auth mail to a dedicated ESP this week (Postmark/SES/Mailgun/SendGrid/Resend)?
- Any constraints (compliance, cost, timeline) that block an ESP change?

---

## D) Minimal fix plan (ranked, with exact changes needed)

Audit-only note: items below describe **exact next edits**, but have not been applied in this step.

### Do now for launch (fastest highest impact)

1) **SPF + DKIM + DMARC for the From-domain (deliverability foundation)**
- **What to change**: DNS for the domain used in `EMAIL_USER` (the From-domain).
- **DNS record templates (placeholders; provider-specific values required)**
  - SPF (root):
    - `TXT  @  "v=spf1 <PROVIDER_SPF_MECHANISMS> -all"`
  - DKIM (provider-specific selector + key):
    - `TXT  <selector>._domainkey  "v=DKIM1; k=rsa; p=<PUBLIC_KEY>"`
  - DMARC (start relaxed; tighten after verification):
    - `TXT  _dmarc  "v=DMARC1; p=none; rua=mailto:dmarc@<from-domain>; adkim=r; aspf=r; fo=1"`
- **Evidence still needed**: which provider is `EMAIL_HOST` so we know the correct SPF include + DKIM selector(s).

2) **Prevent preview environments from sending real auth mail and/or generating `*.vercel.app` login links**
- **Code files that would change**:
  - `app/api/send-magic-link/route.ts`
  - `app/api/send-admin-magic-link/route.ts`
  - `app/api/external/magic-link/route.ts`
  - `lib/email/sendLoginEmail.ts`
- **Exact env vars to introduce**:
  - `EMAIL_SEND_ENABLED` (server-only; set `true` only in prod)
  - `INTELLIWATT_BASE_URL="https://intelliwatt.com"` (server-only; used for email links + image base)
- **Exact behavior change**:
  - If `EMAIL_SEND_ENABLED` is not truthy, routes should not send and should not log full links (dev-only behavior ok).
  - Email links should use `INTELLIWATT_BASE_URL` (not `VERCEL_URL`) to avoid preview-host links.

3) **Decouple SMTP auth user from visible From identity**
- **Current risk**: `EMAIL_USER` is used as both SMTP auth user and From header identity.
- **Code file that would change**: `lib/email/sendLoginEmail.ts`
- **Env vars needed**:
  - `EMAIL_FROM="login@intelliwatt.com"` (visible From)
  - Optional: `EMAIL_FROM_NAME="IntelliWatt"` (or split by stream), `EMAIL_REPLY_TO="support@intelliwatt.com"`
  - Keep `EMAIL_USER` strictly as SMTP auth username if your provider requires it

4) **Remove magic-link leakage in responses/logs**
- **Code files that would change**:
  - `app/api/external/magic-link/route.ts` (stop returning `magicLink` except in dev)
  - `app/api/send-magic-link/route.ts`, `app/api/send-admin-magic-link/route.ts`, `lib/email/sendLoginEmail.ts` (stop logging full URLs except dev)
- **Why (deliverability-adjacent)**: forwarded/posted login links increase “this is phishing” perception and spam complaints.

### Do next week (harder/longer)

5) **Move auth mail to a dedicated transactional ESP**
- **Code files that would change**:
  - `lib/email/sendLoginEmail.ts` (swap transport)
- **Env vars (examples; choose one provider)**:
  - Postmark: `POSTMARK_SERVER_TOKEN`, `EMAIL_FROM`
  - SES: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `EMAIL_FROM`
- **DNS**: provider DKIM + (if applicable) custom return-path/bounce domain records

6) **Template/copy tightening to reduce phishing heuristics**
- **Code file that would change**: `lib/email/sendLoginEmail.ts`
- **Copy/UI changes**:
  - Prefer “Sign in to IntelliWatt” over “magic link”
  - Avoid mixed-brand From name unless the From-domain and landing page are clearly that brand
  - Add “Requested for: <email>” and timestamp line (common anti-phishing pattern)

7) **Operational observability for mail**
- **Code file that would change**: `lib/email/sendLoginEmail.ts` and sender routes
- Add structured logging (corrId, messageId, provider response) without logging the full link/token.

---

## E) Verification steps (copy-paste, PowerShell-safe)

These steps avoid `&&` and do not require deployment.

### 1) Run a test send locally

Where: **Local Windows PowerShell** (repo root)

Set env vars (example placeholders):

```powershell
$env:NEXT_PUBLIC_BASE_URL = "http://localhost:3000"
$env:EMAIL_HOST = "<your-smtp-host>"
$env:EMAIL_PORT = "587"
$env:EMAIL_USER = "<smtp-username>"
$env:EMAIL_PASS = "<smtp-password>"
```

Start dev server:

```powershell
npm install
npm run dev
```

In a second PowerShell window, request a magic link:

```powershell
Invoke-RestMethod -Method POST `
  -Uri "http://localhost:3000/api/send-magic-link" `
  -ContentType "application/json" `
  -Body (@{ email = "you@yourdomain.com" } | ConvertTo-Json)
```

### 2) Inspect the raw message headers produced (local Mailpit)

Where: **Local Windows PowerShell**

Run Mailpit:

```powershell
docker run -p 1025:1025 -p 8025:8025 axllent/mailpit
```

Point the app at Mailpit SMTP:

```powershell
$env:EMAIL_HOST = "localhost"
$env:EMAIL_PORT = "1025"
$env:EMAIL_USER = "login@intelliwatt.com"
$env:EMAIL_PASS = "x"
```

Trigger a send again, then open Mailpit UI at `http://localhost:8025` and inspect:
- Headers: `From`, `To`, `Subject`, `Return-Path` (if present)
- MIME structure: confirm both `text/plain` and `text/html` exist

### 3) Confirm baseUrl behavior (preview vs prod simulation)

Simulate preview:

```powershell
Remove-Item Env:\NEXT_PUBLIC_BASE_URL -ErrorAction SilentlyContinue
$env:VERCEL_URL = "example-preview.vercel.app"
```

Trigger `/api/send-magic-link` and confirm the logged link host is `https://example-preview.vercel.app/...`.

Simulate prod:

```powershell
$env:NEXT_PUBLIC_BASE_URL = "https://intelliwatt.com"
Remove-Item Env:\VERCEL_URL -ErrorAction SilentlyContinue
```

Trigger again and confirm the logged link host is `https://intelliwatt.com/...`.

### 4) Confirm Nodemailer is setting both `text` + `html`

In Mailpit, open the captured message and verify both parts exist and render correctly.


