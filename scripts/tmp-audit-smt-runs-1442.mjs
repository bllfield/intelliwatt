import fs from "node:fs";

const transcriptPath = process.argv[2];
const lineNum = Number(process.argv[3] || 1442);

const lines = fs.readFileSync(transcriptPath, "utf8").split(/\n/).filter(Boolean);
const text = JSON.parse(lines[lineNum - 1]).message.content.find((c) => c.type === "text").text;

function extractSection(startIdx, endIdx) {
  const slice = text.slice(startIdx, endIdx);
  const pick = (re) => {
    const m = slice.match(re);
    return m ? m[1].trim() : null;
  };
  const dailyRows = [
    ...slice.matchAll(
      /(\d{4}-\d{2}-\d{2})\t([\d.]+)\t(ACTUAL|SIMULATED)(?:\s+\(([^)]+)\))?/g,
    ),
    ...slice.matchAll(/(\d{4}-\d{2}-\d{2})\s+([\d.]+)\s+kWh\s+(ACTUAL|SIMULATED)(?:\s+\(([^)]+)\))?/g),
  ].map((m) => ({
    date: m[1],
    kwh: Number(m[2]),
    kind: m[3],
    detail: (m[4] || "").replace(/\//g, "_").toUpperCase() || null,
  }));
  return {
    dataCoverage: pick(/Data coverage:\s*([^\n]+)/i),
    netUsage: pick(/Net usage\s*\n\s*([\d.]+)\s*kWh/i),
    baseload15: pick(/Baseload \(15-min\)\s*\n\s*([\d.]+)/i),
    baseloadDaily: pick(/Baseload \(daily\)\s*\n\s*([\d.]+)/i),
    baseloadMonthly: pick(/Baseload \(monthly\)\s*\n\s*([\d.]+)/i),
    dailyCount: pick(/Daily usage \((\d+) days\)/i),
    dailyRows,
    wapeLine: pick(/(WAPE[^\n]+)/i),
    simAccuracy: pick(/Simulation accuracy[^\n]*\n\s*([^\n]+)/i),
  };
}

const usage = extractSection(0, text.indexOf("Baseline usage"));
const baseline = extractSection(text.indexOf("Baseline usage"), text.indexOf("Past simulated"));
const past = extractSection(text.indexOf("Past simulated"), text.indexOf('{\n  "purpose"'));

console.log("=== UI: Usage dashboard ===");
console.log(JSON.stringify(usage, null, 2));
console.log("\n=== UI: Baseline usage ===");
console.log(JSON.stringify(baseline, null, 2));
console.log("\n=== UI: Past simulated (headline only) ===");
console.log(
  JSON.stringify(
    {
      dataCoverage: past.dataCoverage,
      netUsage: past.netUsage,
      baseload15: past.baseload15,
      baseloadDaily: past.baseloadDaily,
      baseloadMonthly: past.baseloadMonthly,
      dailyCount: past.dailyCount,
      wapeLine: past.wapeLine,
      simAccuracy: past.simAccuracy,
      tailSample: past.dailyRows.filter((r) => r.date >= "2026-05-14"),
      travelSample: past.dailyRows.filter((r) => r.date >= "2025-05-19" && r.date <= "2025-05-25"),
    },
    null,
    2,
  ),
);

const jsonStart = text.indexOf('{\n  "purpose"');
let depth = 0;
let jsonEnd = -1;
for (let j = jsonStart; j < text.length; j++) {
  if (text[j] === "{") depth++;
  else if (text[j] === "}") {
    depth--;
    if (depth === 0) {
      jsonEnd = j;
      break;
    }
  }
}
const payload = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
const meta = payload.aiPayloadMeta || {};
console.log("\n=== JSON (Past Sim copy payload) ===");
console.log("mode:", meta.selectedMode, "runType:", meta.runType, "source:", meta.sourceKind);

const baselineDaily =
  payload.loadedSourceContext?.userUsagePageBaselineContract?.dataset?.daily || [];
const pastRows = payload.runDisplayContract?.dailyUsage?.rows || payload.runDisplayContract?.rows || [];

let mismatchActual = 0;
const samples = [];
for (const r of pastRows) {
  if (r.source !== "ACTUAL") continue;
  const d = String(r.date).slice(0, 10);
  const b = baselineDaily.find((x) => String(x.date).startsWith(d));
  if (b && Math.abs(Number(r.kwh) - Number(b.kwh)) > 0.01) {
    mismatchActual++;
    if (samples.length < 10) samples.push({ d, past: r.kwh, base: b.kwh, detail: r.sourceDetail });
  }
}

console.log("past display rows:", pastRows.length);
console.log("baseline daily in payload:", baselineDaily.length);
console.log("ACTUAL-labeled past rows != baseline:", mismatchActual);
if (samples.length) console.log("samples:", samples);

const tally = {};
for (const r of pastRows) {
  const k = `${r.source}/${r.sourceDetail || ""}`;
  tally[k] = (tally[k] || 0) + 1;
}
console.log("past row tally:", tally);

const ledger =
  payload.loadedSourceContext?.actualDatasetMeta?.smtDayLedgerStatusByDate || {};
const counts =
  payload.loadedSourceContext?.actualDatasetMeta?.smtIntervalCountsByDate || {};
console.log("\nTail ledger + parity (JSON vs UI past table):");
for (const d of ["2025-11-02", "2026-05-16", "2026-05-17", "2026-05-18", "2026-05-19"]) {
  const ui = past.dailyRows.find((r) => r.date === d);
  const disp = pastRows.find((x) => String(x.date).startsWith(d));
  const base = baselineDaily.find((x) => String(x.date).startsWith(d));
  const usageUi = usage.dailyRows.find((r) => r.date === d);
  const baseUi = baseline.dailyRows.find((r) => r.date === d);
  console.log(
    [
      d,
      `ledger=${ledger[d] ?? "—"}`,
      `slots=${counts[d] ?? "—"}`,
      `usageUI=${usageUi?.kwh ?? "—"}`,
      `baseUI=${baseUi?.kwh ?? "—"}`,
      `pastUI=${ui?.kwh ?? "—"}/${ui?.kind ?? "—"}`,
      `pastJSON=${disp?.kwh ?? "—"}`,
      `baseJSON=${base?.kwh ?? "—"}`,
    ].join(" | "),
  );
}

// Cross-headline parity
console.log("\n=== Headline parity ===");
const headlines = [
  ["Usage net", usage.netUsage],
  ["Baseline net", baseline.netUsage],
  ["Past net", past.netUsage],
  ["Usage baseload15", usage.baseload15],
  ["Baseline baseload15", baseline.baseload15],
  ["Past baseload15", past.baseload15],
];
for (const [label, val] of headlines) console.log(`${label}: ${val}`);

const usageBaseNetMatch = usage.netUsage === baseline.netUsage;
const usageBaseBaseloadMatch = usage.baseload15 === baseline.baseload15;
console.log("Usage vs Baseline net match:", usageBaseNetMatch);
console.log("Usage vs Baseline baseload15 match:", usageBaseBaseloadMatch);

let usageBaseDailyMismatch = 0;
const usageDates = new Set(usage.dailyRows.map((r) => r.date));
for (const r of baseline.dailyRows) {
  const u = usage.dailyRows.find((x) => x.date === r.date);
  if (!u) continue;
  if (Math.abs(u.kwh - r.kwh) > 0.01 || u.kind !== r.kind) usageBaseDailyMismatch++;
}
console.log("Usage vs Baseline daily row mismatches:", usageBaseDailyMismatch);

let pastActualVsBaseUi = 0;
for (const r of past.dailyRows) {
  if (r.kind !== "ACTUAL") continue;
  const b = baseline.dailyRows.find((x) => x.date === r.date);
  if (b && Math.abs(r.kwh - b.kwh) > 0.01) pastActualVsBaseUi++;
}
console.log("Past UI ACTUAL rows != Baseline UI kWh:", pastActualVsBaseUi);

const incompleteUi = past.dailyRows.filter((r) =>
  String(r.detail || "").includes("INCOMPLETE"),
);
console.log(
  "Past UI INCOMPLETE rows:",
  incompleteUi.map((r) => `${r.date} ${r.kwh} ${r.detail}`),
);

const validationUi = past.dailyRows.filter((r) =>
  String(r.detail || "").includes("VALIDATION"),
);
console.log("Past UI VALIDATION rows:", validationUi.length);

const simTravelUi = past.dailyRows.filter((r) => r.kind === "SIMULATED");
console.log("Past UI SIMULATED rows:", simTravelUi.length);

// JSON payload detail
const incompleteJson = pastRows.filter((r) =>
  String(r.sourceDetail || "").includes("INCOMPLETE"),
);
console.log(
  "Past JSON INCOMPLETE:",
  incompleteJson.map((r) => ({
    date: String(r.date).slice(0, 10),
    kwh: r.kwh,
    detail: r.sourceDetail,
  })),
);

const validationJson = pastRows.filter((r) =>
  String(r.sourceDetail || "").includes("VALIDATION"),
);
console.log("Past JSON VALIDATION count:", validationJson.length);

const compare =
  payload.runDisplayContract?.compare?.rows ||
  payload.readModel?.compareProjection?.rows ||
  [];
const wape =
  payload.runDisplayContract?.compare?.wapePct ??
  payload.readModel?.compareProjection?.wapePct ??
  payload.runDisplayContract?.compare?.summary?.wapePct;
console.log("compare rows:", compare.length, "wape:", wape);

// Usage vs baseline daily from UI (tab table)
if (usage.dailyRows.length && baseline.dailyRows.length) {
  let uiMismatch = 0;
  for (const r of usage.dailyRows) {
    const b = baseline.dailyRows.find((x) => x.date === r.date);
    if (!b) continue;
    if (Math.abs(r.kwh - b.kwh) > 0.01 || r.kind !== b.kind) uiMismatch++;
  }
  console.log("Usage UI daily rows:", usage.dailyRows.length);
  console.log("Baseline UI daily rows:", baseline.dailyRows.length);
  console.log("Usage vs Baseline UI daily mismatches:", uiMismatch);
const incKeys =
  payload.simRunAudit?.datasetMeta?.smtIncompleteMeterDateKeys ||
  payload.smtIncompleteMeterDateKeys;
const byDate =
  payload.simRunAudit?.datasetMeta?.smtWindowByDate ||
  payload.loadedSourceContext?.actualDatasetMeta?.smtWindowByDate;
console.log("smtIncompleteMeterDateKeys:", JSON.stringify(incKeys));
console.log("byDate 2025-11-02:", JSON.stringify(byDate?.["2025-11-02"]));
const lock1102 = (payload.simRunAudit?.diagnostics?.lockboxPerDayTrace || []).find((r) =>
  String(r.date || r.localDate).startsWith("2025-11-02"),
);
if (lock1102) console.log("lockbox 2025-11-02:", JSON.stringify(lock1102).slice(0, 500));

const wapeUi = past.simAccuracy || past.wapeLine;
console.log("Past UI WAPE/simAccuracy:", wapeUi);
const compareSummary = payload.runDisplayContract?.compare?.summary;
console.log("compare summary:", JSON.stringify(compareSummary)?.slice(0, 400));
const compareRows = payload.runDisplayContract?.compare?.rows || [];
if (compareRows.length) {
  let sumAbs = 0;
  let sumAct = 0;
  for (const r of compareRows) {
    const a = Number(r.actualDayKwh ?? r.actualKwh);
    const s = Number(r.simulatedDayKwh ?? r.simKwh);
    if (!Number.isFinite(a) || !Number.isFinite(s)) continue;
    sumAbs += Math.abs(a - s);
    sumAct += a;
  }
  const wapeCalc = sumAct > 0 ? ((sumAbs / sumAct) * 100).toFixed(2) + "%" : "n/a";
  console.log("computed WAPE from compare rows:", wapeCalc, "rows:", compareRows.length);
  console.log(
    "sample compare:",
    compareRows.slice(0, 3).map((r) => ({
      date: r.localDate || r.date,
      actual: r.actualDayKwh ?? r.actualKwh,
      sim: r.simulatedDayKwh ?? r.simKwh,
    })),
  );
  const perDay = compareRows.map((r) => {
    const a = Number(r.actualDayKwh ?? r.actualKwh);
    const s = Number(r.simulatedDayKwh ?? r.simKwh);
    const errPct = a > 0 ? (Math.abs(a - s) / a) * 100 : null;
    return { date: r.localDate || r.date, actual: a, sim: s, errPct: errPct != null ? errPct.toFixed(1) + "%" : null };
  });
  console.log("per-day validation errors:", JSON.stringify(perDay, null, 0));
}

for (const d of ["2026-05-18", "2026-05-19", "2025-11-02"]) {
    const u = usage.dailyRows.find((x) => x.date === d);
    const b = baseline.dailyRows.find((x) => x.date === d);
    const p = past.dailyRows.find((x) => x.date === d);
    console.log(
      `${d}: usage=${u?.kwh}/${u?.kind} base=${b?.kwh}/${b?.kind} past=${p?.kwh}/${p?.kind}/${p?.detail}`,
    );
  }
}
