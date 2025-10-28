'use client'
import React from 'react'
import { centsToUSD } from '@/lib/ui/currency'
import { extractOutboundUrl } from '@/lib/recommend/outbound'

type Line = { label: string; cents: number }
type Breakdown = {
  kwh: number
  energyChargeCents: number
  baseFeeCents: number
  minUsageFeeCents: number
  billCreditsCents: number
  tdspMonthlyFeeCents: number
  tdspVolumetricCents: number
  subtotalCents: number
  totalCents: number
  lines: Line[]
}

export type PlanCardProps = {
  planId: string
  supplierName: string
  planName: string
  tdsp: string
  productType: string
  termMonths: number
  cancelFeeCents?: number | null
  hasBillCredit: boolean
  disclosures: { eflUrl?: string | null; tosUrl?: string | null; yracUrl?: string | null }
  breakdown: Breakdown
  docs?: any
  canEnroll?: boolean        // NEW: gate the CTA until consent is checked
  // WattBuy compliance fields
  supplierPuctRegistration?: string | null
  supplierContactEmail?: string | null
  supplierContactPhone?: string | null
  distributorName?: string | null
}

export default function PlanCard(props: PlanCardProps) {
  const {
    planId, supplierName, planName, tdsp, productType, termMonths, cancelFeeCents, hasBillCredit, disclosures, breakdown, docs, canEnroll,
    supplierPuctRegistration, supplierContactEmail, supplierContactPhone, distributorName
  } = props

  const outbound = extractOutboundUrl(docs)
  const cancelFee = typeof cancelFeeCents === 'number' ? centsToUSD(cancelFeeCents) : '—'
  const total = centsToUSD(breakdown.totalCents)
  const perKwh = breakdown.kwh > 0 ? (breakdown.totalCents / breakdown.kwh / 100).toFixed(3) : '—'

  const enabled = Boolean(outbound && canEnroll)

  const handleSelectPlan = async () => {
    if (!enabled) return
    
    // Log offer selection for audit trail
    try {
      await fetch('/api/audit/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          supplierName,
          planName,
          tdsp,
          userKey: undefined, // Could be passed as prop if needed
          metadata: {
            productType,
            termMonths,
            cancelFeeCents,
            hasBillCredit,
            totalCents: breakdown.totalCents,
            kwh: breakdown.kwh
          }
        })
      })
    } catch (e) {
      console.warn('Failed to log offer selection:', e)
    }
  }

  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      padding: 16,
      display: 'grid',
      gap: 8,
      background: '#fff',
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{supplierName}</div>
          <div style={{ color: '#374151' }}>{planName} · {productType.toUpperCase()} · {termMonths} mo</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{total}</div>
          <div style={{ color: '#6b7280', fontSize: 12 }}>{perKwh} $/kWh est.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Badge label={`Cancel fee: ${cancelFee}`} />
        {hasBillCredit ? <Badge label="Bill credit plan" tone="blue" /> : null}
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Line items</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {breakdown.lines.map((ln, idx) => (
            <li key={idx} style={{ color: ln.cents < 0 ? '#065f46' : '#111827' }}>
              {ln.label}: <strong>{centsToUSD(ln.cents)}</strong>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Supplier Information</div>
        <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          <InfoRow label="Distributor" value={distributorName || tdsp} />
          <InfoRow label="PUCT Registration" value={supplierPuctRegistration} />
          <InfoRow label="Contact Email" value={supplierContactEmail} />
          <InfoRow label="Contact Phone" value={supplierContactPhone} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <a href={disclosures.eflUrl || '#'} target="_blank" rel="noreferrer"
           style={linkStyle(disclosures.eflUrl)}>EFL</a>
        <a href={disclosures.tosUrl || '#'} target="_blank" rel="noreferrer"
           style={linkStyle(disclosures.tosUrl)}>TOS</a>
        <a href={disclosures.yracUrl || '#'} target="_blank" rel="noreferrer"
           style={linkStyle(disclosures.yracUrl)}>YRAC</a>

        <div style={{ flex: 1 }} />
        {enabled ? (
          <a 
            href={extractOutboundUrl(docs)!} 
            target="_blank" 
            rel="noreferrer" 
            style={ctaStyle}
            onClick={handleSelectPlan}
          >
            Select plan
          </a>
        ) : (
          <button
            title={canEnroll ? 'No enrollment link available for this offer yet' : 'Please agree to the disclosures first'}
            style={{ ...ctaStyle, opacity: 0.5, cursor: 'not-allowed' }}
            disabled
          >
            Select plan
          </button>
        )}
      </div>
    </div>
  )
}

function Badge({ label, tone = 'slate' }: { label: string; tone?: 'slate' | 'blue' }) {
  const bg = tone === 'blue' ? '#dbeafe' : '#f1f5f9'
  const fg = tone === 'blue' ? '#1d4ed8' : '#334155'
  return (
    <span style={{ background: bg, color: fg, borderRadius: 999, padding: '2px 8px', fontSize: 12 }}>{label}</span>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  const displayValue = value && value.trim() ? value : 'Not provided by supplier'
  const isMissing = !value || !value.trim()
  
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: '#6b7280' }}>{label}:</span>
      <span style={{ color: isMissing ? '#9ca3af' : '#111827', fontWeight: isMissing ? 400 : 500 }}>
        {displayValue}
      </span>
    </div>
  )
}

function linkStyle(enabled?: string | null): React.CSSProperties {
  return {
    color: enabled ? '#2563eb' : '#9ca3af',
    textDecoration: enabled ? 'underline' : 'none',
    pointerEvents: enabled ? 'auto' : 'none'
  }
}

const ctaStyle: React.CSSProperties = {
  background: '#16a34a',
  color: 'white',
  padding: '8px 12px',
  borderRadius: 8,
  fontWeight: 700
}
