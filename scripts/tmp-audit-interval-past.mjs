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

const json = JSON.parse(lastText.slice(lastText.indexOf("{"), lastText.lastIndexOf("}") + 1));

console.log("includesSimRunAudit:", json.aiPayloadMeta?.includesSimRunAudit);
console.log("compactResponse:", json.simRunAudit?.compactResponse);
console.log("engine:", json.simRunAudit?.artifactIdentity?.engineVersion);

const simByDate = json.simRunAudit?.datasetMeta?.simulatedSourceDetailByDate;
if (simByDate) {
  console.log("\nsimulatedSourceDetailByDate tail:");
  for (const d of ["2026-05-14", "2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18"]) {
    console.log(" ", d, simByDate[d] ?? "—");
  }
} else {
  console.log("\nno simulatedSourceDetailByDate in simRunAudit.datasetMeta");
}

const ledger =
  json.loadedSourceContext?.actualDatasetMeta?.smtDayLedgerStatusByDate ||
  json.simRunAudit?.datasetMeta?.smtDayLedgerStatusByDate;
if (ledger) {
  console.log("\nsmtDayLedgerStatusByDate tail:");
  for (const d of ["2026-05-14", "2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18"]) {
    console.log(" ", d, ledger[d] ?? "—");
  }
} else {
  console.log("\nno smtDayLedgerStatusByDate in payload");
}

const counts = json.loadedSourceContext?.actualDatasetMeta?.smtIntervalCountsByDate;
if (counts) {
  console.log("\nsmtIntervalCountsByDate tail:");
  for (const d of ["2026-05-14", "2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18"]) {
    console.log(" ", d, counts[d] ?? "—");
  }
}
