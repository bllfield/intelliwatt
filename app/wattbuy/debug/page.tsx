// app/wattbuy/debug/page.tsx
// Step 6 (optional): Minimal debug UI to exercise the three API routes safely.

'use client';

import { useState } from 'react';

type LogEntry = {
  loading?: boolean;
  path?: string;
  status?: number;
  body?: any;
  json?: any;
};

export default function WattBuyDebug() {
  const [address, setAddress] = useState('8808 Las Vegas Ct');
  const [city, setCity] = useState('White Settlement');
  const [state, setState] = useState('TX');
  const [zip, setZip] = useState('76108');

  const [wattkey, setWattkey] = useState('');
  const [esiid, setEsiid] = useState('');
  const [log, setLog] = useState<LogEntry | null>(null);

  async function call(path: string, body: any) {
    setLog({ loading: true, path, body });
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setLog({ loading: false, path, body, status: res.status, json });
    return { status: res.status, json };
  }

  const commonBox = { padding: 12, borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff' };
  const btn = { padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#111827', color: '#fff' as const, cursor: 'pointer' };

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto', fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>WattBuy Debug</h1>
      <p style={{ color: '#6b7280', marginBottom: 16 }}>
        Use this page in <strong>dev only</strong> to test ESIID → Home → Offers. Nothing here touches your live flows.
      </p>

      <div style={{ display: 'grid', gap: 16 }}>
        {/* Address Inputs */}
        <section style={commonBox}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Address</h2>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '2fr 1.2fr 0.8fr 0.8fr' }}>
            <input value={address} onChange={(e)=>setAddress(e.target.value)} placeholder="Address" />
            <input value={city} onChange={(e)=>setCity(e.target.value)} placeholder="City" />
            <input value={state} onChange={(e)=>setState(e.target.value)} placeholder="State" />
            <input value={zip} onChange={(e)=>setZip(e.target.value)} placeholder="Zip" />
          </div>
        </section>

        {/* Step 1: ESIID */}
        <section style={commonBox}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>1) ESIID lookup (/api/wattbuy/esiid)</h2>
          <button
            style={btn}
            onClick={async ()=>{
              const { json } = await call('/api/wattbuy/esiid', { address, city, state, zip });
              const first = json?.normalized ?? json?.addresses?.[0];
              if (first?.wattkey) setWattkey(first.wattkey);
              if (first?.esiid) setEsiid(first.esiid);
            }}>
            Lookup ESIID & Wattkey
          </button>
          <div style={{ marginTop: 8, display: 'grid', gap: 8, gridTemplateColumns: '1fr 3fr' }}>
            <label>ESIID</label>
            <input value={esiid} onChange={(e)=>setEsiid(e.target.value)} placeholder="esiid" />
            <label>Wattkey</label>
            <input value={wattkey} onChange={(e)=>setWattkey(e.target.value)} placeholder="wattkey" />
          </div>
        </section>

        {/* Step 2: Home Details */}
        <section style={commonBox}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>2) Home/Utility details (/api/wattbuy/home)</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={btn} onClick={()=>call('/api/wattbuy/home', { wattkey })} disabled={!wattkey}>Fetch by wattkey</button>
            <button style={btn} onClick={()=>call('/api/wattbuy/home', { esiid })} disabled={!esiid}>Fetch by esiid</button>
            <button style={btn} onClick={()=>call('/api/wattbuy/home', { address, city, state, zip })}>Fetch by address</button>
          </div>
        </section>

        {/* Step 3: Offers */}
        <section style={commonBox}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>3) Offers (/api/wattbuy/offers)</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={btn} onClick={()=>call('/api/wattbuy/offers', { wattkey })} disabled={!wattkey}>Offers by wattkey</button>
            <button style={btn} onClick={()=>call('/api/wattbuy/offers', { address, city, state, zip })}>Offers by address</button>
          </div>
          <p style={{ color: '#6b7280', marginTop: 6 }}>
            Expect electricity plan objects with <code>offer_id</code>, <code>offer_data.efl</code>, <code>offer_data.kwh500/1000/2000</code>, etc.
          </p>
        </section>

        {/* Log */}
        <section style={{ ...commonBox, background: '#0b1020', color: '#d1d5db' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Response Log</h2>
            <button
              style={{ ...btn, background: 'transparent', color: '#d1d5db', borderColor: '#374151' }}
              onClick={()=>setLog(null)}
            >
              Clear
            </button>
          </div>
          <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 420, overflow: 'auto' }}>
            {log ? JSON.stringify(log, null, 2) : 'No calls yet.'}
          </pre>
        </section>
      </div>
    </div>
  );
}
