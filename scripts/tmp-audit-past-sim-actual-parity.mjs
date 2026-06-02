import fs from "node:fs";

const transcriptPath =
  process.argv[2] ||
  "C:/Users/bllfi/.cursor/projects/c-Users-bllfi-Documents-Intellipath-Solutions-Intelliwatt-Website-intelliwatt-clean/agent-transcripts/f33e2565-f9e8-4e3e-9678-e80b447b2790/f33e2565-f9e8-4e3e-9678-e80b447b2790.jsonl";
const lineNum = Number(process.argv[3] || 102);

const lines = fs.readFileSync(transcriptPath, "utf8").split(/\n/).filter(Boolean);
const wrap = JSON.parse(lines[lineNum - 1]);
const text = wrap.message.content.find((c) => c.type === "text").text;
let payload;
const jsonStart = text.indexOf("{");
const jsonEnd = text.lastIndexOf("}");
if (jsonStart >= 0 && jsonEnd > jsonStart) {
  try {
    payload = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch {
    payload = null;
  }
}
if (!payload) {
  const body = text
    .replace(/^[\s\S]*?<user_query>\s*/, "")
    .replace(/\s*<\/user_query>[\s\S]*$/, "");
  payload = JSON.parse(body);
}

const pastDaily =
  payload.runDisplayContract?.dailyUsage?.rows ||
  payload.runDisplayView?.dailyRows ||
  [];
const pastArtifactDaily =
  payload.readModel?.dataset?.daily ||
  payload.runResult?.readModel?.dataset?.daily ||
  [];
const baselineDaily =
  payload.loadedSourceContext?.userUsagePageBaselineContract?.dataset?.daily ||
  payload.userUsagePageBaselineContract?.dataset?.daily ||
  [];
const compareRows = payload.runDisplayContract?.compare?.rows || payload.readModel?.compareProjection?.rows || [];
const lockbox = payload.simRunAudit?.diagnostics?.lockboxPerDayTrace || [];

const baselineByDate = new Map(
  baselineDaily.map((r) => [String(r.date).slice(0, 10), { kwh: Number(r.kwh), source: r.source, sourceDetail: r.sourceDetail }])
);
const pastByDate = new Map(
  pastDaily.map((r) => [String(r.date).slice(0, 10), { kwh: Number(r.kwh), source: r.source, sourceDetail: r.sourceDetail }])
);
const artifactByDate = new Map(
  pastArtifactDaily.map((r) => [String(r.date).slice(0, 10), { kwh: Number(r.kwh), source: r.source, sourceDetail: r.sourceDetail }])
);
const compareByDate = new Map(
  compareRows.map((r) => [
    String(r.localDate || r.date).slice(0, 10),
    { actual: Number(r.actualDayKwh ?? r.actualKwh), sim: Number(r.simulatedDayKwh ?? r.simKwh) },
  ])
);
const lockboxByDate = new Map(lockbox.map((r) => [String(r.date || r.localDate).slice(0, 10), r]));

const allDates = new Set([
  ...baselineByDate.keys(),
  ...pastByDate.keys(),
  ...compareByDate.keys(),
]);
const sorted = [...allDates].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();

let mismatches = [];
for (const d of sorted) {
  const b = baselineByDate.get(d);
  const p = pastByDate.get(d);
  const c = compareByDate.get(d);
  const lb = lockboxByDate.get(d);
  if (!b && !p) continue;
  const bk = b?.kwh;
  const pk = p?.kwh;
  const ca = c?.actual;
  const cs = c?.sim;
  const diffPastVsBase = b && p && Math.abs((pk ?? 0) - (bk ?? 0)) > 0.01;
  const diffCompareActualVsBase = b && c && Math.abs((ca ?? 0) - (bk ?? 0)) > 0.01;
  const diffPastVsCompareActual = p && c && Math.abs((pk ?? 0) - (ca ?? 0)) > 0.01;
  if (diffPastVsBase || diffCompareActualVsBase || diffPastVsCompareActual) {
    mismatches.push({
      date: d,
      baselineKwh: bk,
      baselineSource: b?.sourceDetail ?? b?.source,
      pastDisplayKwh: pk,
      pastSource: p?.sourceDetail ?? p?.source,
      compareActualKwh: ca,
      compareSimKwh: cs,
      lockboxKind: lb?.kind ?? lb?.dayKind ?? lb?.traceKind,
      lockboxReason: lb?.reason ?? lb?.simReason,
    });
  }
}

console.log("pastDaily rows:", pastDaily.length);
console.log("pastArtifactDaily rows:", pastArtifactDaily.length);
console.log("baselineDaily rows:", baselineDaily.length);
console.log("compareRows:", compareRows.length);
console.log("lockbox days:", lockbox.length);
console.log("mismatch days:", mismatches.length);

const show = mismatches.slice(0, 30);
for (const m of show) {
  console.log(JSON.stringify(m));
}
if (mismatches.length > 30) console.log(`... and ${mismatches.length - 30} more`);

const actualLabeledPast = pastDaily.filter((r) => r.source === "ACTUAL");
const actualNotMatchingBaseline = actualLabeledPast.filter((r) => {
  const d = String(r.date).slice(0, 10);
  const b = baselineByDate.get(d);
  return b && Math.abs(Number(r.kwh) - Number(b.kwh)) > 0.01;
});
const artifactActualNotMatchingBaseline = pastArtifactDaily.filter((r) => {
  const d = String(r.date).slice(0, 10);
  const b = baselineByDate.get(d);
  return String(r.source).toUpperCase() === "ACTUAL" && b && Math.abs(Number(r.kwh) - Number(b.kwh)) > 0.01;
});
const displayDiffersFromArtifact = pastDaily.filter((r) => {
  const d = String(r.date).slice(0, 10);
  const a = artifactByDate.get(d);
  return a && Math.abs(Number(r.kwh) - Number(a.kwh)) > 0.01;
});
console.log("\nPast daily rows labeled ACTUAL:", actualLabeledPast.length);
console.log("ACTUAL-labeled display rows != baseline kWh:", actualNotMatchingBaseline.length);
console.log("ACTUAL-labeled artifact daily != baseline kWh:", artifactActualNotMatchingBaseline.length);
console.log("Display daily != artifact daily kWh:", displayDiffersFromArtifact.length);
for (const r of actualNotMatchingBaseline.slice(0, 15)) {
  const d = String(r.date).slice(0, 10);
  const art = artifactByDate.get(d);
  console.log(
    `${d}: display=${Number(r.kwh)} artifact=${art?.kwh ?? "—"} baseline=${baselineByDate.get(d)?.kwh} detail=${r.sourceDetail}`
  );
}

const simulatedPast = pastDaily.filter((r) => r.source === "SIMULATED");
console.log("\nSIMULATED display rows:", simulatedPast.length);
console.log("Sample SIMULATED:", simulatedPast.slice(0, 3).map((r) => ({ date: r.date, kwh: r.kwh, detail: r.sourceDetail })));

const vmDaily = payload.userUsageDashboardViewModel?.derived?.daily ?? [];
console.log("\nviewModel derived daily rows:", vmDaily.length);
for (const d of ["2026-05-16", "2026-05-17", "2026-05-18", "2025-05-19"]) {
  const vm = vmDaily.find((r) => String(r.date).startsWith(d));
  const disp = pastByDate.get(d);
  const base = baselineByDate.get(d);
  console.log(`${d}: baseline=${base?.kwh} vm=${vm?.kwh} display=${disp?.kwh} vmSource=${vm?.source}`);
}

const compare518 = compareRows.find((r) => String(r.localDate || r.date).startsWith("2026-05-18"));
console.log("compare row for 2026-05-18:", compare518 ?? "none");
