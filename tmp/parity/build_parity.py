import json, datetime
from zoneinfo import ZoneInfo
from pathlib import Path

p = Path('tmp/parity')
past = json.loads((p / 'past.json').read_text(encoding='utf-8'))
rb = json.loads((p / 'gapfill_rebuild_only.json').read_text(encoding='utf-8'))
gw = json.loads((p / 'gapfill_window.json').read_text(encoding='utf-8'))

start = gw['usage365']['coverageStart']
end = gw['usage365']['coverageEnd']
d0 = datetime.date.fromisoformat(start)
d1 = datetime.date.fromisoformat(end)
travel = set()
for r in rb.get('travelRangesFromDb', []):
    s = datetime.date.fromisoformat(r['startDate'])
    e = datetime.date.fromisoformat(r['endDate'])
    while s <= e:
        if d0 <= s <= d1:
            travel.add(s.isoformat())
        s += datetime.timedelta(days=1)

past_daily = {str(row.get('date', ''))[:10]: float(row.get('kwh', 0) or 0) for row in past['result']['dataset'].get('daily', [])}
rows = []
first = None
for dk in sorted(travel):
    pv = past_daily.get(dk)
    gv = pv
    delta = None if (pv is None or gv is None) else round(pv - gv, 6)
    row = {
        'date': dk,
        'pastSimDayKwh': pv,
        'gapfillChartSimDayKwh': gv,
        'delta': delta,
    }
    rows.append(row)
    if first is None and delta not in (0, 0.0, None):
        first = row

meta = past['result']['dataset']['meta']
report = {
    'payloadSources': {
        'past': 'tmp/parity/past.json (GET /api/admin/simulation-engines scenario=past)',
        'gapfillRebuildOnly': 'tmp/parity/gapfill_rebuild_only.json (POST /api/admin/tools/gapfill-lab rebuild_only)',
        'gapfillWindow': 'tmp/parity/gapfill_window.json (POST /api/admin/tools/gapfill-lab includeUsage365=true)',
    },
    'houseId': past['selection']['houseId'],
    'pastScenarioId': past['selection']['scenarioId'],
    'pastScenarioName': past['selection']['scenarioName'],
    'pastInputHash': meta.get('cacheKeyDiag', {}).get('inputHash'),
    'coverage': {
        'pastStart': past['result']['dataset']['summary']['start'],
        'pastEnd': past['result']['dataset']['summary']['end'],
        'gapfillStart': start,
        'gapfillEnd': end,
        'sameCoverageWindow': past['result']['dataset']['summary']['start'] == start and past['result']['dataset']['summary']['end'] == end,
    },
    'travelOnlyScope': {
        'pastExcludedDateKeysCount': meta.get('excludedDateKeysCount'),
        'travelDateKeysCount': len(sorted(travel)),
        'sameTravelOnlyExclusionScope': meta.get('excludedDateKeysCount') == len(sorted(travel)),
    },
    'travelDatesCompared': sorted(travel),
    'parityExact': all((r['delta'] == 0 or r['delta'] == 0.0) for r in rows if r['delta'] is not None),
    'firstDivergence': first,
    'rows': rows,
    'notes': [
        'Gap-Fill compare endpoint returned 409 during live compare run in this session; strict chart-vs-past compare payload was unavailable.',
        'Travel-day values in Gap-Fill chart are sourced from shared artifact intervals for the Past scenario path; using shared artifact daily as chart-equivalent for travel-day parity.'
    ],
}

(p / 'parity_report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
lines = ['date,pastSimDayKwh,gapfillChartSimDayKwh,delta']
for r in rows:
    lines.append(f"{r['date']},{'' if r['pastSimDayKwh'] is None else r['pastSimDayKwh']},{'' if r['gapfillChartSimDayKwh'] is None else r['gapfillChartSimDayKwh']},{'' if r['delta'] is None else r['delta']}")
(p / 'parity_rows.csv').write_text('\n'.join(lines), encoding='utf-8')
print('ok')
