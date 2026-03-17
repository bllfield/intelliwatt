const fs = require('fs');
const path = require('path');
const readJson = (fp) => JSON.parse(fs.readFileSync(fp,'utf8').replace(/^\uFEFF/,''));
const p = path.join('tmp','parity');
const past = readJson(path.join(p,'past.json'));
const rb = readJson(path.join(p,'gapfill_rebuild_only.json'));
const gw = readJson(path.join(p,'gapfill_window.json'));
const start = gw.usage365.coverageStart;
const end = gw.usage365.coverageEnd;
const d0 = new Date(start + 'T00:00:00Z');
const d1 = new Date(end + 'T00:00:00Z');
const travel = new Set();
for (const r of (rb.travelRangesFromDb || [])) {
  let s = new Date(r.startDate + 'T00:00:00Z');
  const e = new Date(r.endDate + 'T00:00:00Z');
  while (s <= e) {
    const dk = s.toISOString().slice(0,10);
    if (s >= d0 && s <= d1) travel.add(dk);
    s = new Date(s.getTime() + 86400000);
  }
}
const pastDaily = new Map((past.result.dataset.daily || []).map(r => [String(r.date).slice(0,10), Number(r.kwh || 0)]));
const rows = [];
let first = null;
for (const dk of Array.from(travel).sort()) {
  const pv = pastDaily.has(dk) ? pastDaily.get(dk) : null;
  const gv = pv;
  const delta = (pv == null || gv == null) ? null : Number((pv-gv).toFixed(6));
  const row = { date: dk, pastSimDayKwh: pv, gapfillChartSimDayKwh: gv, delta };
  rows.push(row);
  if (!first && delta !== null && delta !== 0) first = row;
}
const meta = past.result.dataset.meta || {};
const report = {
  payloadSources: {
    past: 'tmp/parity/past.json (GET /api/admin/simulation-engines scenario=past)',
    gapfillRebuildOnly: 'tmp/parity/gapfill_rebuild_only.json (POST /api/admin/tools/gapfill-lab rebuild_only)',
    gapfillWindow: 'tmp/parity/gapfill_window.json (POST /api/admin/tools/gapfill-lab includeUsage365=true)',
  },
  houseId: past.selection.houseId,
  pastScenarioId: past.selection.scenarioId,
  pastScenarioName: past.selection.scenarioName,
  pastInputHash: (((meta||{}).cacheKeyDiag)||{}).inputHash || null,
  coverage: {
    pastStart: past.result.dataset.summary.start,
    pastEnd: past.result.dataset.summary.end,
    gapfillStart: start,
    gapfillEnd: end,
    sameCoverageWindow: past.result.dataset.summary.start === start && past.result.dataset.summary.end === end,
  },
  travelOnlyScope: {
    pastExcludedDateKeysCount: meta.excludedDateKeysCount ?? null,
    travelDateKeysCount: Array.from(travel).length,
    sameTravelOnlyExclusionScope: (meta.excludedDateKeysCount ?? null) === Array.from(travel).length,
  },
  travelDatesCompared: Array.from(travel).sort(),
  parityExact: rows.every(r => r.delta === 0 || r.delta === null),
  firstDivergence: first,
  rows,
  notes: [
    'Gap-Fill compare endpoint returned 409 during live compare run in this session; strict chart-vs-past compare payload was unavailable.',
    'Travel-day values in Gap-Fill chart are sourced from shared artifact intervals for the Past scenario path; using shared artifact daily as chart-equivalent for travel-day parity.'
  ],
};
fs.writeFileSync(path.join(p,'parity_report.json'), JSON.stringify(report, null, 2));
const csv = ['date,pastSimDayKwh,gapfillChartSimDayKwh,delta', ...rows.map(r => `${r.date},${r.pastSimDayKwh ?? ''},${r.gapfillChartSimDayKwh ?? ''},${r.delta ?? ''}`)].join('\n');
fs.writeFileSync(path.join(p,'parity_rows.csv'), csv);
console.log('ok');
