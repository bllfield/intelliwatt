import "dotenv/config";
import fs from "fs";
import path from "path";
import https from "https";
import { config as dotenvConfig } from "dotenv";

const root = process.cwd();
for (const file of [".env.local", ".env"]) {
  const full = path.join(root, file);
  if (fs.existsSync(full)) {
    dotenvConfig({ path: full, override: false });
  }
}

function must(name, hint) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}${hint ? ` — ${hint}` : ""}`);
  return v;
}

function opt(name, def = "") {
  return process.env[name] ?? def;
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers,
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Request timeout")));
  });
}

function oneOf(...values) {
  return values.find(Boolean);
}

(async () => {
  try {
    const BASE = opt("PROD_BASE_URL", "https://intelliwatt.com");
    const ADMIN_TOKEN = must("ADMIN_TOKEN", "set ADMIN_TOKEN in .env.local or shell");
    const TEST_URL = oneOf(process.env.ERCOT_TEST_URL, process.env.ERCOT_DAILY_URL);
    if (!TEST_URL) throw new Error("Missing ERCOT_TEST_URL or ERCOT_DAILY_URL");

    console.log("== Testing fetch-latest ==");
    const fetchUrl = `${BASE}/api/admin/ercot/fetch-latest?url=${encodeURIComponent(TEST_URL)}&notes=smoke-test`;
    const res1 = await get(fetchUrl, { "x-admin-token": ADMIN_TOKEN });
    console.log("Status:", res1.status);
    console.log("Body:", res1.body.slice(0, 600));

    if (res1.status !== 200) {
      console.error("❌ fetch-latest failed");
      process.exit(1);
    }

    const data = JSON.parse(res1.body);
    if (data.ok) {
      console.log(`✅ Ingested rows: ${data.result?.rowsUpsert ?? "unknown"} (sha=${data.sha256})`);
    } else if (data.skipped && data.reason === "duplicate_hash") {
      console.log(`✅ Skipped duplicate hash (sha=${data.sha256})`);
    } else {
      console.error("❌ Unexpected response:", res1.body);
      process.exit(1);
    }

    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      console.log("\n== Testing cron route ==");
      const cronUrl = `${BASE}/api/admin/ercot/cron?token=${encodeURIComponent(cronSecret)}`;
      const res2 = await get(cronUrl);
      console.log("Status:", res2.status);
      console.log("Body:", res2.body.slice(0, 600));
      if (res2.status !== 200) {
        console.error("❌ cron route failed");
        process.exit(1);
      }
      const data2 = JSON.parse(res2.body);
      if (!data2.ok) {
        console.error("❌ cron route returned error:", res2.body);
        process.exit(1);
      }
      console.log("✅ Cron route succeeded");
    } else {
      console.log("(i) CRON_SECRET not set; skipping cron test");
    }

    console.log("\n🎉 ERCOT fetch tests completed successfully.");
    process.exit(0);
  } catch (err) {
    console.error("TEST ERROR:", err?.message || err);
    process.exit(1);
  }
})();

