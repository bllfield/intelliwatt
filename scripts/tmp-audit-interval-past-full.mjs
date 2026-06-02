import fs from "fs";

const path =
  "C:/Users/bllfi/.cursor/projects/c-Users-bllfi-Documents-Intellipath-Solutions-Intelliwatt-Website-intelliwatt-clean/agent-transcripts/a0c7678b-358a-4d41-9407-5936820901bd/a0c7678b-358a-4d41-9407-5936820901bd.jsonl";
const lineNum = Number(process.argv[2] || 1024);
const lines = fs.readFileSync(path, "utf8").split(/\n/).filter(Boolean);
const wrap = JSON.parse(lines[lineNum - 1]);
const text = wrap.message.content.find((c) => c.type === "text").text;
const body = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
const payload = JSON.parse(body);

const display = payload.runDisplayContract;
const rows = display?.dailyRows ?? display?.rows ?? [];
const meta = payload.simRunAudit ?? payload.engineOutputMeta ?? {};

console.log("rowCount", rows.length);
const byDetail = {};
const bySource = {};
for (const r of rows) {
  byDetail[r.sourceDetail] = (byDetail[r.sourceDetail] || 0) + 1;
  bySource[r.source] = (bySource[r.source] || 0) + 1;
}
console.log("bySource", bySource);
console.log("bySourceDetail", byDetail);

const ledger = meta.smtDayLedgerStatusByDate ?? payload.actualDatasetMeta?.smtDayLedgerStatusByDate;
if (ledger) {
  const counts = {};
  for (const v of Object.values(ledger)) counts[v] = (counts[v] || 0) + 1;
  console.log("ledgerCounts", counts, "ledgerDays", Object.keys(ledger).length);
}

const incomplete = meta.smtIncompleteMeterDateKeys ?? [];
const pending = meta.pendingSmtIntervalDateKeys ?? [];
console.log("pendingSmtIntervalDateKeys", pending);
console.log("smtIncompleteMeterDateKeys", incomplete.length);

let issues = [];
for (const dk of incomplete) {
  const row = rows.find((r) => r.date === dk);
  if (!row) issues.push(`${dk}: missing row`);
  else if (row.sourceDetail !== "SIMULATED_INCOMPLETE_METER")
    issues.push(`${dk}: ${row.sourceDetail}`);
}
for (const dk of pending) {
  const row = rows.find((r) => r.date === dk);
  if (!row) issues.push(`pending ${dk}: missing row`);
  else if (row.sourceDetail !== "SIMULATED_INTERVALS_NOT_AVAILABLE_YET")
    issues.push(`pending ${dk}: ${row.sourceDetail}`);
}

const canon = meta.smtCanonicalEndDate;
if (canon) {
  const row = rows.find((r) => r.date === canon);
  const led = ledger?.[canon];
  if (led !== "PENDING_SMT") issues.push(`canonical ledger ${canon}=${led}`);
  if (row?.sourceDetail !== "SIMULATED_INTERVALS_NOT_AVAILABLE_YET")
    issues.push(`canonical display ${canon}=${row?.sourceDetail}`);
}

const travel = payload.currentControls?.travelRanges ?? payload.engineInput?.travelRanges ?? [];
if (travel.length) {
  for (const tr of travel) {
    const row = rows.find((r) => r.date === tr.startDate || r.date === tr.start);
    if (row && row.sourceDetail !== "SIMULATED_TRAVEL_VACANT")
      issues.push(`travel ${tr.startDate || tr.start}: ${row.sourceDetail}`);
  }
}

const badActual = rows.filter(
  (r) =>
    r.source === "ACTUAL" &&
    ![
      "ACTUAL",
      "ACTUAL_VALIDATION_TEST_DAY",
      "ACTUAL_INCOMPLETE_METER",
    ].includes(r.sourceDetail),
);
if (badActual.length) issues.push(`unexpected ACTUAL details: ${badActual.length}`);

console.log("issues", issues.length ? issues : "none");
console.log(
  "engine",
  meta.engineVersion ?? payload.engineVersion,
  "mode",
  payload.selectedMode,
  "runType",
  payload.aiPayloadMeta?.runType,
);
