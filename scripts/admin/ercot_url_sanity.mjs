import "dotenv/config";
import fs from "fs";
import path from "path";
import { config as dotenvConfig } from "dotenv";

const root = process.cwd();
for (const rel of [".env.local", ".env", ".env.production.local", ".vercel/.env.production.local"]) {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) {
    dotenvConfig({ path: full, override: false });
  }
}

const getEnv = (name) => process.env[name] || "";
const ADMIN_TOKEN = getEnv("ADMIN_TOKEN");
const BASE = getEnv("PROD_BASE_URL") || "https://intelliwatt.com";
const URL_TEST = getEnv("ERCOT_TEST_URL") || getEnv("ERCOT_DAILY_URL");

const errors = [];
if (!ADMIN_TOKEN) errors.push("ADMIN_TOKEN is missing.");
if (!URL_TEST) errors.push("ERCOT_TEST_URL (or ERCOT_DAILY_URL) is missing.");

if (errors.length) {
  console.error("❌ Sanity check failed:");
  for (const err of errors) console.error("  -", err);
  console.error("\nFix env vars, then run: npm run test:ercot:fetch");
  process.exit(1);
}

const curlCmd = `curl -sS -H "x-admin-token: $ADMIN_TOKEN" "${BASE}/api/admin/ercot/fetch-latest?url=${encodeURIComponent(URL_TEST)}&notes=cursor-sanity"`;
console.log("✅ Sanity OK.\n");
console.log("Admin token present");
console.log("Fetch URL   :", URL_TEST);
console.log("Prod base   :", BASE);
console.log("\nExact command to fetch:");
console.log(curlCmd);
console.log("\nNext steps:\n  1) npm run test:ercot:fetch\n  2) curl -H \"x-admin-token: $ADMIN_TOKEN\" \"" + BASE + "/api/admin/ercot/ingests?limit=5\"");
