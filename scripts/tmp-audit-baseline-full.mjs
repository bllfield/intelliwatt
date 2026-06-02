import fs from "node:fs";

const path =
  process.argv[2] ||
  "C:/Users/bllfi/.cursor/projects/c-Users-bllfi-Documents-Intellipath-Solutions-Intelliwatt-Website-intelliwatt-clean/agent-transcripts/a0c7678b-358a-4d41-9407-5936820901bd/a0c7678b-358a-4d41-9407-5936820901bd.jsonl";
const lineNum = Number(process.argv[3] || 2034);

const lines = fs.readFileSync(path, "utf8").split(/\n/).filter(Boolean);
const wrap = JSON.parse(lines[lineNum - 1]);
const text = wrap.message.content.find((c) => c.type === "text").text;
const body = text
  .replace(/^[\s\S]*?<user_query>\s*/, "")
  .replace(/\s*<\/user_query>[\s\S]*$/, "");
const json = JSON.parse(body);

const pick = (obj, path) =>
  path.split(".").reduce((a, k) => (a && a[k] != null ? a[k] : undefined), obj);

console.log("LINE", lineNum);
console.log("runType:", pick(json, "aiPayloadMeta.runType"));
console.log("baselinePassthrough:", pick(json, "aiPayloadMeta.baselinePassthrough"));
console.log("house:", pick(json, "currentControls.actualContextHouseId"));

const actualMeta =
  json.loadedSourceContext?.actualDatasetMeta || json.actualDatasetMeta || {};
console.log("\nactualDatasetMeta keys:", Object.keys(actualMeta).sort().join(", "));
console.log("coverage:", actualMeta.coverageStart, "->", actualMeta.coverageEnd);
console.log("tsMin/tsMax:", actualMeta.tsMin, actualMeta.tsMax);
console.log("intervalCount:", actualMeta.intervalCount);

const counts = actualMeta.smtIntervalCountsByDate || {};
const ledger = actualMeta.smtDayLedgerStatusByDate || {};
const tailKeys = Object.keys({ ...counts, ...ledger })
  .filter((k) => k >= "2026-05-10")
  .sort();
console.log("\nTail ledger + slot counts:");
for (const d of tailKeys) {
  console.log(`  ${d}: ledger=${ledger[d] ?? "—"} slots=${counts[d] ?? "—"}`);
}

const rows =
  json.runDisplayContract?.dailyUsage?.rows || json.runDisplayContract?.rows || [];
const sourceTally = {};
for (const r of rows) {
  const k = `${r.source}/${r.sourceDetail}`;
  sourceTally[k] = (sourceTally[k] || 0) + 1;
}
console.log("\nrunDisplayContract row source tally:", sourceTally);
console.log("row count:", rows.length);

const dvm = json.dashboardViewModel || json.runDisplayContract?.dashboardViewModel;
if (dvm) {
  const dRows = dvm.dailyRows || dvm.rows || [];
  const dTally = {};
  for (const r of dRows) {
    const k = `${r.source || r.usageSource}/${r.sourceDetail || r.label || ""}`;
    dTally[k] = (dTally[k] || 0) + 1;
  }
  console.log("\ndashboardViewModel row tally:", dTally);
}

const parity = json.paritySections || json.simRunAudit?.paritySections;
if (parity) {
  console.log("\nparitySections keys:", Object.keys(parity).join(", "));
  for (const k of ["usageVsBaseline", "tailDay", "canonicalEndDay"]) {
    if (parity[k]) console.log(k + ":", JSON.stringify(parity[k]).slice(0, 300));
  }
}

const trace = json.envReadinessTrace || json.simRunAudit?.envReadinessTrace;
if (trace) {
  console.log("\nenvReadinessTrace keys:", Object.keys(trace).join(", "));
  if (trace.smtWindow) console.log("smtWindow:", JSON.stringify(trace.smtWindow).slice(0, 400));
  if (trace.usageSourceResolution)
    console.log("usageSourceResolution:", JSON.stringify(trace.usageSourceResolution).slice(0, 400));
}

const incomplete =
  json.simRunAudit?.datasetMeta?.smtIncompleteMeterDateKeys ||
  json.smtIncompleteMeterDateKeys ||
  actualMeta.smtIncompleteMeterDateKeys;
console.log("\nincompleteMeterDateKeys:", JSON.stringify(incomplete));

const retry = json.smtIncompleteMeterRetry || json.simRunAudit?.smtIncompleteMeterRetry;
if (retry) {
  console.log("\nretry summary:");
  console.log("  attempted:", retry.attempted);
  console.log("  repairKind:", retry.repairKind);
  console.log("  requestedDateKeys:", retry.requestedDateKeys);
  const br = retry.refreshResult?.backfill?.[0];
  if (br) {
    console.log("  backfill start/end:", br.startDate, br.endDate);
    console.log("  backfill ok:", br.ok, br.message || br.error);
  }
}

// Search for unknown-source signals in compact areas
const compact = JSON.stringify({
  meta: actualMeta,
  audit: json.simRunAudit?.datasetMeta,
  contract: {
    coverageEnd: json.runDisplayContract?.coverageEnd,
    lastRow: rows[rows.length - 1],
  },
});
for (const term of ["UNKNOWN", "unknown", "SIMULATED", "PASSTHROUGH", "2026-05-18"]) {
  const idx = compact.indexOf(term);
  console.log(`\nsearch '${term}':`, idx >= 0 ? "found" : "not in compact slice");
}
