# 🧠 IntelliWatt Developer Architecture

## 📦 Project Structure

This project is built modularly — each feature lives in its own isolated route or API module to prevent future collisions.

### Routes

| Route                        | Purpose |
|-----------------------------|---------|
| `/`                         | Public landing page |
| `/login`                    | Magic link auth (no password) |
| `/dashboard`                | Overview + intro hub |
| `/dashboard/entries`        | Jackpot tracker + checklist |
| `/dashboard/home`           | Home details (Zillow/API/manual) |
| `/dashboard/appliances`     | Appliance intake w/ photos |
| `/dashboard/referrals`      | Referral tools + shareable link |
| `/dashboard/api`            | Smart device + SMT connect |
| `/dashboard/plans`          | Current plan + switching options |
| `/dashboard/analysis`       | Final insights + charts |
| `/dashboard/manual-entry`   | Bill upload or Green Button data |
| `/dashboard/usage`          | View real 15-min consumption |
| `/dashboard/upgrades`       | Upgrade & retrofit recommendations simulator. Combines usage, appliance, weather, and envelope data to simulate monthly savings from insulation, HVAC, lighting, window, or solar upgrades. Results may be sent via email/text and not shown in dashboard. |
| `/privacy`                  | Required legal policy |
| `/rules`                    | HTJW official sweepstakes rules |
| `/dev/instructions`         | Internal only — dev reference page |

---

## 🚫 DO NOTs

- ❌ Do not mix modules
- ❌ Do not store logic inside dashboard/page.tsx
- ❌ Do not reuse state across subpages without clear interface
- ❌ Do not touch `MagicLinkToken`, `User`, `Referral`, or `EnergyUsage` schemas unless extending

---

## 🧰 Tools in Use

- **Next.js 14+ App Router**
- **Prisma** (`@prisma/client`)
- **Tailwind CSS**
- **Nodemailer** (email login links)
- **Cursor** (AI developer tool)
- Future: **WattBuy API**, **Smart Meter Texas API**, **Zillow + Google Address**, **Vision AI for appliances**

---

## ✅ Development Rules

- All new features must be built as isolated pages or modules
- Only extend backend through `/api/*` routes
- Place shared UI components in `/components`
- All calculations, scoring, analysis will be performed **after all data is submitted**, never during intake
- Use mock success states for unconnected modules (like API pulls)

--- 