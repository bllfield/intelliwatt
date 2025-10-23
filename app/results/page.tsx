'use client'
import React, { useMemo, useState } from 'react'
import PlanCard from '@/components/plan/PlanCard'
import { ConsentPanel } from '@/components/compliance/Consent'

type Interval = { start: string; kwh: number }
type Recommendation = {
  planId: string
  supplierName: string
  planName: string
  termMonths: number
  tdsp: string
  productType: string
  cancelFeeCents?: number | null
  hasBillCredit: boolean
  disclosures: { eflUrl?: string | null; tosUrl?: string | null; yracUrl?: string | null }
  quote: {
    ok: true
    periodStart: string
    periodEnd: string
    tdsp: string
    kwh: number
    breakdown: {
      kwh: number
      energyChargeCents: number
      baseFeeCents: number
      minUsageFeeCents: number
      billCreditsCents: number
      tdspMonthlyFeeCents: number
      tdspVolumetricCents: number
      subtotalCents: number
      totalCents: number
      lines: { label: string; cents: number }[]
    }
  }
}

export default function ResultsPage() {
  const [tdsp, setTdsp] = useState<'ONCOR'|'CENTERPOINT'|'AEP_NORTH'|'AEP_CENTRAL'|'TNMP'>('ONCOR')
  const [periodStart, setPeriodStart] = useState<string>(defaultPeriodStart())
  const [periodEnd, setPeriodEnd] = useState<string>(defaultPeriodEnd())
  const [monthlyKwh, setMonthlyKwh] = useState<number>(1000)
  const [intervalJson, setIntervalJson] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [results, setResults] = useState<Recommendation[]>([])
  const [consent, setConsent] = useState<boolean>(false)

  const intervals = useMemo<Interval[]>(() => {
    if (intervalJson.trim()) {
      try {
        const parsed = JSON.parse(intervalJson)
        if (Array.isArray(parsed)) return parsed
      } catch { /* ignore */ }
    }
    return synthesizeHourlyIntervals(periodStart, periodEnd, monthlyKwh)
  }, [intervalJson, periodStart, periodEnd, monthlyKwh])

  async function run() {
    if (!consent) {
      setError('Please agree to the disclosures before continuing.')
      return
    }
    setLoading(true)
    setError('')
    setResults([])
    try {
      const res = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tdsp, periodStart, periodEnd, intervals, limit: 10 })
      })
      const json = await res.json()
      if (!res.ok || json?.ok === false) throw new Error(json?.error || 'Unknown error')
      setResults(json.results || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch recommendations')
    } finally {
      setLoading(false)
    }
  }

  const estUsage = intervals.reduce((a, b) => a + (b.kwh || 0), 0)

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>Plan recommendations</h1>
      <p style={{ color: '#525252', marginTop: 0 }}>
        Enter a billing window and usage. Use <strong>Monthly kWh</strong> for a quick estimate or paste actual SMT intervals JSON.
      </p>

      <div style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'repeat(12, 1fr)',
        alignItems: 'end',
        background: '#f8fafc',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 12,
        marginBottom: 16
      }}>
        <div style={{ gridColumn: 'span 3' }}>
          <label className="lbl">TDSP</label>
          <select value={tdsp} onChange={e => setTdsp(e.target.value as any)} className="inp">
            <option>ONCOR</option>
            <option>CENTERPOINT</option>
            <option>AEP_NORTH</option>
            <option>AEP_CENTRAL</option>
            <option>TNMP</option>
          </select>
        </div>
        <div style={{ gridColumn: 'span 3' }}>
          <label className="lbl">Period start</label>
          <input className="inp" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
        </div>
        <div style={{ gridColumn: 'span 3' }}>
          <label className="lbl">Period end</label>
          <input className="inp" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
        </div>
        <div style={{ gridColumn: 'span 3' }}>
          <label className="lbl">Monthly kWh (fallback)</label>
          <input className="inp" type="number" min={1} value={monthlyKwh} onChange={e => setMonthlyKwh(parseInt(e.target.value || '0', 10))} />
        </div>
        <div style={{ gridColumn: 'span 12' }}>
          <label className="lbl">Or paste SMT intervals JSON (array of {{start,kwh}})</label>
          <textarea
            className="inp"
            placeholder='[{"start":"2025-09-01T00:00:00Z","kwh":0.25}]'
            rows={5}
            value={intervalJson}
            onChange={e => setIntervalJson(e.target.value)}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          />
        </div>
        <div style={{ gridColumn: 'span 12', display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={run} disabled={loading || !consent} style={{ ...btnPrimary, opacity: loading || !consent ? 0.6 : 1 }}>
            {loading ? 'Calculating…' : 'Get recommendations'}
          </button>
          <span style={{ color: '#6b7280', fontSize: 12 }}>
            Using {intervalJson.trim() ? 'pasted intervals' : `synthetic hourly profile`} · Est. {Math.round(estUsage)} kWh
          </span>
        </div>
      </div>

      {/* Compliance & consent */}
      <ConsentPanel checked={consent} onChange={setConsent} />

      {error ? <div style={{ color: '#b91c1c', marginTop: 12 }}>⚠️ {error}</div> : null}

      {/* Results */}
      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        {results.map((r) => (
          <PlanCard
            key={r.planId}
            supplierName={r.supplierName}
            planName={r.planName}
            productType={r.productType}
            termMonths={r.termMonths}
            cancelFeeCents={r.cancelFeeCents}
            hasBillCredit={r.hasBillCredit}
            disclosures={r.disclosures}
            breakdown={r.quote.breakdown}
            // docs={r.docs} // enable this once Step 70/69 include docs or outboundUrl
            canEnroll={consent}
          />
        ))}
      </div>

      <style>{`
        .lbl { display:block; font-size:12px; color:#374151; margin-bottom:6px; font-weight:600; }
        .inp {
          width:100%;
          border:1px solid #e5e7eb;
          border-radius:8px;
          padding:8px 10px;
          background:#fff;
        }
      `}</style>
    </main>
  )
}

function defaultPeriodStart() {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - 1, 1)
  return d.toISOString().slice(0,10)
}
function defaultPeriodEnd() {
  const d = new Date()
  d.setUTCDate(1)
  return d.toISOString().slice(0,10)
}

/**
 * Creates a flat hourly profile summing to monthlyKwh across the window.
 * This is a gentle fallback for demo/QA when real SMT intervals aren't pasted.
 */
function synthesizeHourlyIntervals(startStr: string, endStr: string, monthlyKwh: number): Interval[] {
  const start = new Date(startStr + 'T00:00:00Z').getTime()
  const end = new Date(endStr + 'T00:00:00Z').getTime()
  const hours = Math.max(1, Math.floor((end - start) / 3600_000))
  const per = monthlyKwh / hours
  return Array.from({ length: hours }, (_, i) => ({
    start: new Date(start + i * 3600_000).toISOString(),
    kwh: per
  }))
}

const btnPrimary: React.CSSProperties = {
  background: '#111827',
  color: '#fff',
  border: '1px solid #111827',
  borderRadius: 8,
  padding: '10px 14px',
  fontWeight: 700
}
