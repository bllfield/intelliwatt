#!/usr/bin/env node
/**
 * Test script to trigger SMT ingest for a specific ESIID
 * Usage: node scripts/test-smt-ingest.mjs <ESIID>
 */

const ESIID = process.argv[2] || "10443720004895510";
const DROPLET_WEBHOOK_URL = process.env.DROPLET_WEBHOOK_URL || "http://64.225.25.54:8787/trigger/smt-now";
const WEBHOOK_SECRET = process.env.INTELLIWATT_WEBHOOK_SECRET || process.env.DROPLET_WEBHOOK_SECRET || "";

if (!WEBHOOK_SECRET) {
  console.error("Error: Set INTELLIWATT_WEBHOOK_SECRET or DROPLET_WEBHOOK_SECRET environment variable");
  process.exit(1);
}

async function triggerIngest() {
  console.log(`\n=== Triggering SMT ingest for ESIID: ${ESIID} ===`);
  console.log(`Webhook URL: ${DROPLET_WEBHOOK_URL}`);

  const payload = {
    reason: "smt_authorized",
    ts: new Date().toISOString(),
    esiid: ESIID,
    monthsBack: 3,
    windowFrom: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    windowTo: new Date().toISOString(),
  };

  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(DROPLET_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-intelliwatt-secret": WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    console.log(`\nResponse status: ${response.status}`);
    
    try {
      const json = JSON.parse(text);
      console.log("Response body:", JSON.stringify(json, null, 2));
    } catch {
      console.log("Response body (raw):", text);
    }

    if (response.ok) {
      console.log("\n✅ Webhook triggered successfully. Check droplet logs for ingest progress.");
    } else {
      console.log("\n❌ Webhook returned non-2xx status. Check droplet logs.");
    }
  } catch (err) {
    console.error("❌ Failed to reach droplet webhook:", err.message);
    process.exit(1);
  }
}

triggerIngest();
