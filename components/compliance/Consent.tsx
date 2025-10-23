'use client'
import React from 'react'
import { TX_COMPLIANCE_COPY } from '@/lib/compliance/tx'

export function ConsentPanel({
  checked, onChange, privacyUrl, termsUrl,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  privacyUrl?: string
  termsUrl?: string
}) {
  const priv = privacyUrl || process.env.NEXT_PUBLIC_PRIVACY_URL || process.env.PRIVACY_URL || '/privacy'
  const terms = termsUrl || process.env.NEXT_PUBLIC_TERMS_URL || process.env.TERMS_URL || '/terms'
  return (
    <section style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      padding: 16,
      display: 'grid',
      gap: 10
    }}>
      <div style={{ fontWeight: 800 }}>{TX_COMPLIANCE_COPY.heading}</div>
      <ul style={{ margin: 0, paddingLeft: 18, color: '#334155' }}>
        {TX_COMPLIANCE_COPY.bullets.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
      <div style={{ color: '#6b7280', fontSize: 12 }}>
        See our <a href={priv} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>Privacy Policy</a> and{' '}
        <a href={terms} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>Terms</a>.
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>{TX_COMPLIANCE_COPY.consentLabel}</span>
      </label>
    </section>
  )
}
