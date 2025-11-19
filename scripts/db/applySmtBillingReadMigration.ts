import fs from "fs";
import path from "path";
import { Client } from "pg";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[DB] DATABASE_URL is not set. Export it before running this script.");
    process.exit(1);
  }

  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20251119070500_add_smt_billing_read",
    "migration.sql",
  );

  if (!fs.existsSync(migrationPath)) {
    console.error("[DB] Migration file not found:", migrationPath);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, "utf8").trim();
  if (!sql) {
    console.error("[DB] Migration file is empty:", migrationPath);
    process.exit(1);
  }

  console.log("[DB] Connecting to DATABASE_URL to apply SmtBillingRead migration...");

  const urlLower = dbUrl.toLowerCase();
  const sslRequired = urlLower.includes("sslmode=require") || urlLower.includes("ssl=true");

  const client = new Client({
    connectionString: dbUrl,
    ssl: sslRequired
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  });

  try {
    await client.connect();
    console.log("[DB] Running migration SQL from:", migrationPath);
    await client.query(sql);
    console.log("[DB] ✅ SmtBillingRead migration applied successfully.");
  } catch (err) {
    console.error("[DB] ❌ Error applying SmtBillingRead migration:");
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[DB] Unexpected error:", (err as Error).message);
  process.exit(1);
});
