#!/usr/bin/env node
import fs from "node:fs";

const path =
  process.argv[2] ||
  "C:/Users/bllfi/.cursor/projects/c-Users-bllfi-Documents-Intellipath-Solutions-Intelliwatt-Website-intelliwatt-clean/agent-transcripts/a0c7678b-358a-4d41-9407-5936820901bd/a0c7678b-358a-4d41-9407-5936820901bd.jsonl";

const lines = fs.readFileSync(path, "utf8").trim().split(/\r?\n/);
let lastText = null;
for (const line of lines) {
  try {
    const o = JSON.parse(line);
    const t = o?.message?.content?.[0]?.text;
    if (!t?.includes("selectedMode")) continue;
    if (!/selectedMode":\s*"INTERVAL"/.test(t)) continue;
    if (!/runType":\s*"PAST_SIM"/.test(t) && !/pastSim":\s*true/.test(t)) continue;
    lastText = t;
  } catch {
    /* skip */
  }
}

if (!lastText) {
  console.error("No INTERVAL PAST_SIM payload found");
  process.exit(1);
}

const start = lastText.indexOf("{");
const end = lastText.lastIndexOf("}");
const json = JSON.parse(lastText.slice(start, end + 1));

const meta = json.aiPayloadMeta || {};
console.log("runType:", meta.runType);
console.log("engine:", json.simRunAudit?.engineVersion || json.engineVersion);
console.log(
  "coverage:",
  json.runDisplayContract?.coverageEnd ||
    json.actualDatasetMeta?.coverageEnd ||
    json.dataset?.meta?.coverageEnd
);

const rows =
  json.runDisplayContract?.dailyUsage?.rows ||
  json.runDisplayContract?.rows ||
  [];

for (const d of ["2026-05-14", "2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18"]) {
  const r = rows.find((x) => String(x.date || "").startsWith(d));
  if (!r) {
    console.log(d, "— row missing");
    continue;
  }
  console.log(d, r.source, r.sourceDetail, r.displayLabel || "");
}

const retry =
  json.smtIncompleteMeterRetry ||
  json.simRunAudit?.smtIncompleteMeterRetry ||
  null;
console.log("\nsmtIncompleteMeterRetry:", JSON.stringify(retry, null, 2));

const audit = json.simRunAudit || {};
if (audit.smtDayLedger?.byDate) {
  const tail = Object.fromEntries(
    Object.entries(audit.smtDayLedger.byDate).filter(([k]) => k >= "2026-05-14")
  );
  console.log("\nledger byDate tail:", JSON.stringify(tail, null, 2));
}
