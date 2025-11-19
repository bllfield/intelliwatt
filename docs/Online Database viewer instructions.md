# Online Database Viewer Instructions

These steps walk you through opening a browser-based view of the IntelliWatt database using Prisma Studio. Prisma Studio lets you inspect tables (including `RawSmtFile`, `SmtInterval`, `SmtAuthorization`, etc.) without writing SQL.

---

## Prerequisites

- Visual Studio Code (VS Code) installed
- IntelliWatt repository cloned locally
- Node.js / npm available (bundled with the project’s tooling)
- Access to the correct `DATABASE_URL` in your environment (e.g., via `.env`)

> **Note:** Prisma Studio works against whichever database your `DATABASE_URL` points to. Ensure you’re comfortable inspecting that environment before proceeding.

---

## Launch Prisma Studio from VS Code

1. **Open the IntelliWatt repo in VS Code.**
2. **Open an integrated terminal:**
   - VS Code menu → `View` → `Terminal` (defaults to PowerShell if you installed the PowerShell extension).
3. **Change directory to the project root (if you’re not already there):**
   ```powershell
   cd C:\Users\<you>\Documents\Intellipath Solutions\Intelliwatt Website\intelliwatt-clean
   ```
4. **Run Prisma Studio:**
   ```powershell
   npx prisma studio
   ```
5. Prisma prints a URL such as:
   ```
   Prisma Studio is up on http://localhost:5555
   ```
6. **Open the URL in your browser.** Prisma Studio shows a sidebar with all tables. Click any table to inspect rows.

### Tables you’ll see

- `RawSmtFile` – Stored SMT CSV blobs
- `SmtInterval` – Interval readings (after normalization)
- `SmtAuthorization` – Records of SMT consents
- `HouseAddress`, `User`, etc. – Core application data
- `SmtBillingRead` – Billing/daily usage rows (only appears once the schema migration is applied to that DB)

---

## What to check next

Inside Prisma Studio:

1. Select `RawSmtFile` to verify stored SMT CSVs.
2. Select `SmtInterval` to confirm interval rows exist.
3. If the new schema is deployed, look for `SmtBillingRead` to confirm billing data storage.

If `SmtBillingRead` is missing, it means the migration hasn’t been applied to that database yet.

---

## Alternative: SQL client / DO dashboard

- **DigitalOcean control panel** → Managed Databases → select the IntelliWatt cluster (shows connection strings and metrics).
- **External SQL client** (e.g., TablePlus, DataGrip, psql): use the `DATABASE_URL` or equivalent host/port credentials.
  - Example connection string:
    ```
    postgresql://doadmin:<password>@db-postgresql-nyc3-37693-do-user-27496845-0.k.db.ondigitalocean.com:25060/defaultdb?sslmode=require
    ```
  - You’ll need the actual password from your secrets vault or configured environment.

Prisma Studio is usually the fastest way to peek at data during development, but feel free to use other tools if you prefer SQL queries or GUI clients.
