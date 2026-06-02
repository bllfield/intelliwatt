import fs from "node:fs";

const path =
  process.argv[2] ||
  "C:/Users/bllfi/.cursor/projects/c-Users-bllfi-Documents-Intellipath-Solutions-Intelliwatt-Website-intelliwatt-clean/agent-transcripts/a0c7678b-358a-4d41-9407-5936820901bd/a0c7678b-358a-4d41-9407-5936820901bd.jsonl";

const lineNums = process.argv.slice(3).map(Number).filter(Boolean);
const lines = fs.readFileSync(path, "utf8").split(/\n/).filter(Boolean);

function parsePayload(lineNum) {
  const wrap = JSON.parse(lines[lineNum - 1]);
  const text = wrap.message.content.find((c) => c.type === "text").text;
  const body = text
    .replace(/^[\s\S]*?<user_query>\s*/, "")
    .replace(/\s*<\/user_query>[\s\S]*$/, "");
  return JSON.parse(body);
}

function audit(json, label) {
  const meta = json.aiPayloadMeta || {};
  console.log(`\n========== ${label} ==========`);
  console.log("mode:", meta.selectedMode || json.selectedMode);
  console.log("runType:", meta.runType);
  console.log("source:", meta.sourceKind || json.source);
  console.log(
    "engine:",
    json.simRunAudit?.artifactIdentity?.engineVersion ||
      json.simRunAudit?.engineVersion
  );
  console.log(
    "canonicalEnd:",
    json.simRunAudit?.smtCanonicalEndDate || json.smtCanonicalEndDate
  );

  const ledger =
    json.loadedSourceContext?.actualDatasetMeta?.smtDayLedgerStatusByDate ||
    json.simRunAudit?.datasetMeta?.smtDayLedgerStatusByDate ||
    json.actualDatasetMeta?.smtDayLedgerStatusByDate;
  const counts =
    json.loadedSourceContext?.actualDatasetMeta?.smtIntervalCountsByDate ||
    json.simRunAudit?.datasetMeta?.smtIntervalCountsByDate;
  const simBy = json.simRunAudit?.datasetMeta?.simulatedSourceDetailByDate;
  const rows =
    json.runDisplayContract?.dailyUsage?.rows ||
    json.runDisplayContract?.rows ||
    [];

  const keys = ["2026-05-14", "2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18"];
  console.log("date | ledger | slots | simDetail | source | detail");
  for (const d of keys) {
    const row = rows.find((x) => String(x.date || "").startsWith(d));
    console.log(
      [
        d,
        ledger?.[d] ?? "—",
        counts?.[d] ?? "—",
        simBy?.[d] ?? "—",
        row?.source ?? "—",
        row?.sourceDetail ?? row?.displayLabel ?? "—",
      ].join(" | ")
    );
  }

  const pending =
    json.simRunAudit?.datasetMeta?.smtPendingDateKeys || json.smtPendingDateKeys;
  const incomplete =
    json.simRunAudit?.datasetMeta?.smtIncompleteMeterDateKeys ||
    json.smtIncompleteMeterDateKeys;
  console.log("pending:", JSON.stringify(pending));
  console.log("incomplete:", JSON.stringify(incomplete));

  const retry = json.smtIncompleteMeterRetry || json.simRunAudit?.smtIncompleteMeterRetry;
  if (retry) {
    console.log("retry.attempted:", retry.attempted);
    console.log("retry.repairKind:", retry.repairKind);
    console.log("retry.requestedDateKeys:", JSON.stringify(retry.requestedDateKeys));
    console.log("retry.pullDateKey:", retry.pullDateKey);
  }
}

if (lineNums.length) {
  for (const n of lineNums) audit(parsePayload(n), `LINE ${n}`);
} else {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("canonical_run_response")) continue;
    const mode = lines[i].match(/"selectedMode":\s*"([^"]+)"/)?.[1];
    const runType = lines[i].match(/"runType":\s*"([^"]+)"/)?.[1];
    hits.push({ line: i + 1, mode, runType });
  }
  console.log("canonical_run_response payloads:", hits.length);
  console.log(hits.slice(-15));
}
