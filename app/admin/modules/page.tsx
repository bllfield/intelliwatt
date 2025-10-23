'use client'
import React from 'react'
import { modulesCatalog } from '@/lib/catalog/modules'

export default function ModulesPage() {
  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>IntelliWatt Module Catalog</h1>
      <p style={{ color: '#525252', marginBottom: 24 }}>
        Complete breakdown of all IntelliWatt modules with their purposes, endpoints, inputs, outputs, and estimated development time.
      </p>
      
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 800 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ccc', backgroundColor: '#f8f9fa' }}>
              <th align="left" style={{ padding: '12px 8px', fontWeight: 600 }}>ID</th>
              <th align="left" style={{ padding: '12px 8px', fontWeight: 600 }}>Name</th>
              <th align="left" style={{ padding: '12px 8px', fontWeight: 600 }}>Purpose</th>
              <th align="left" style={{ padding: '12px 8px', fontWeight: 600 }}>Endpoint</th>
              <th align="left" style={{ padding: '12px 8px', fontWeight: 600 }}>Inputs</th>
              <th align="left" style={{ padding: '12px 8px', fontWeight: 600 }}>Outputs</th>
              <th align="left" style={{ padding: '12px 8px', fontWeight: 600 }}>Est. Dev Time</th>
            </tr>
          </thead>
          <tbody>
            {modulesCatalog.map(m => (
              <tr key={m.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '12px 8px', fontFamily: 'monospace', fontWeight: 600 }}>{m.id}</td>
                <td style={{ padding: '12px 8px', fontWeight: 600 }}>{m.name}</td>
                <td style={{ padding: '12px 8px', color: '#374151' }}>{m.purpose}</td>
                <td style={{ padding: '12px 8px', fontFamily: 'monospace', color: '#6b7280' }}>
                  {m.endpoint || '—'}
                </td>
                <td style={{ padding: '12px 8px' }}>
                  <ul style={{ margin: 0, paddingLeft: 16, color: '#374151' }}>
                    {m.inputs.map((input, i) => (
                      <li key={i} style={{ marginBottom: 2 }}>{input}</li>
                    ))}
                  </ul>
                </td>
                <td style={{ padding: '12px 8px' }}>
                  <ul style={{ margin: 0, paddingLeft: 16, color: '#374151' }}>
                    {m.outputs.map((output, i) => (
                      <li key={i} style={{ marginBottom: 2 }}>{output}</li>
                    ))}
                  </ul>
                </td>
                <td style={{ padding: '12px 8px', fontWeight: 600, color: '#059669' }}>{m.estDevTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 32, padding: 16, backgroundColor: '#f8f9fa', borderRadius: 8, border: '1px solid #e5e7eb' }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ fontSize: 14, color: '#6b7280' }}>Total Modules</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{modulesCatalog.length}</div>
          </div>
          <div>
            <div style={{ fontSize: 14, color: '#6b7280' }}>Total Dev Time</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {modulesCatalog.reduce((total, m) => {
                const time = parseFloat(m.estDevTime.replace('d', ''))
                return total + time
              }, 0)}d
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, color: '#6b7280' }}>API Endpoints</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {modulesCatalog.filter(m => m.endpoint).length}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, color: '#6b7280' }}>Database Modules</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {modulesCatalog.filter(m => m.outputs.some(o => o.includes('rows') || o.includes('DB'))).length}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
