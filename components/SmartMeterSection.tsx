'use client';

import { useState, useEffect } from 'react';

type SmartMeterSectionProps = {
  houseId?: string | null;
};

export default function SmartMeterSection({ houseId }: SmartMeterSectionProps) {
  const [mounted, setMounted] = useState(false);
  const [address, setAddress] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'manual'>('idle');
  const [showAwardModal, setShowAwardModal] = useState(false);
  const [manualAwarded, setManualAwarded] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleConnect = async () => {
    if (!consent || !address) {
      alert('Please enter your address and check the consent box.');
      return;
    }

    setStatus('connecting');

    const res = await fetch('/api/smart-meter-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, consent: true }),
    });

    if (res.ok) {
      setStatus('connected');
      // Award 1 entry for connecting smart meter
      try {
        await fetch('/api/user/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'smart_meter_connect',
            amount: 1,
            ...(houseId ? { houseId } : {}),
          }),
        });
        // Refresh entry indicators
        window.dispatchEvent(new CustomEvent('entriesUpdated'));
        setShowAwardModal(true);
      } catch (error) {
        console.error('Error awarding entries:', error);
      }
    } else {
      setStatus('idle');
      alert('Something went wrong connecting your Smart Meter.');
    }
  };

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted) {
    return (
      <section className="bg-white p-8 rounded-2xl border border-brand-navy mb-6 shadow-lg">
        <div className="text-center">
          <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-2xl text-brand-blue">⚡</span>
          </div>
          <h2 className="text-3xl font-bold text-brand-navy mb-3">
            Setup Made <span className="text-brand-blue">Effortless</span>
          </h2>
          <p className="text-lg text-brand-navy max-w-xl mx-auto">
            Connect your Smart Meter account and we'll automatically pull your ESIID, plan details, and usage history.
          </p>
        </div>
      </section>
    );
  }

  if (status === 'connected') {
    return (
      <section className="bg-gradient-to-r from-green-600 to-green-700 text-white p-8 rounded-2xl shadow-lg mb-6 border border-green-500/20 relative">
        <div className="text-center">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">✅</span>
          </div>
          <h2 className="text-3xl font-bold mb-3">Smart Meter Connected!</h2>
          <p className="text-lg text-green-100">Your usage, plan, and ESIID data are now loaded into your dashboard.</p>
        </div>
        {showAwardModal && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white text-brand-navy rounded-xl p-6 max-w-sm w-full shadow-xl">
              <div className="flex items-center gap-3 mb-3">
                <a
                  href="https://www.hitthejackwatt.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex"
                >
                  <img src="/Hitthejackwatt-Logo.png" alt="HitTheJackWatt™" className="w-10 h-6 object-contain" />
                </a>
                <h3 className="text-xl font-bold">Jackpot entries earned!</h3>
              </div>
              <p className="mb-4">You just earned <span className="font-bold" style={{ color: '#39FF14' }}>1 jackpot entry</span> for connecting your smart meter.</p>
              <a href="/dashboard/home" className="inline-block bg-brand-navy text-brand-blue font-bold py-2 px-4 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">Add Home Details →</a>
              <button onClick={() => setShowAwardModal(false)} className="ml-3 inline-block text-sm underline">Dismiss</button>
            </div>
          </div>
        )}
      </section>
    );
  }

  if (status === 'manual') {
    return (
      <section className="bg-white p-8 rounded-2xl border border-brand-navy mb-6 shadow-lg">
        <div className="text-center">
          <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-brand-blue">✍️</span>
          </div>
          <h2 className="text-3xl font-bold text-brand-navy mb-3">Manual Entry</h2>
          <p className="text-lg text-brand-navy mb-6">You chose not to connect automatically. Enter your details manually below.</p>
          {manualAwarded ? (
            <div className="mb-4 inline-block rounded-full border border-brand-navy bg-brand-navy/10 px-4 py-2 text-sm font-semibold" style={{ color: '#39FF14' }}>
              ✓ 1 jackpot entry added for manual usage entry
            </div>
          ) : null}
          {/* TODO: Add manual entry fields later */}
          <p className="text-sm text-brand-navy/80">Coming soon: manual form fields</p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white p-8 rounded-2xl border border-brand-navy mb-6 shadow-lg">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-brand-navy rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
          <span className="text-2xl text-brand-blue">⚡</span>
        </div>
        <h2 className="text-3xl font-bold text-brand-navy mb-3">
          Setup Made <span className="text-brand-blue">Effortless</span>
        </h2>
        <p className="text-lg text-brand-navy max-w-xl mx-auto">
          Connect your Smart Meter account and we'll automatically pull your ESIID, plan details, and usage history.
        </p>
      </div>

      {/* Connection Form */}
      <div className="bg-white p-6 rounded-xl border border-brand-navy">
        <div className="space-y-4">
          <div>
            <label className="block text-brand-navy font-semibold mb-2">
              Service Address
              <span className="ml-2 text-sm font-normal" style={{ color: '#39FF14' }}>
                🎁 Earn 1 jackpot entry by connecting your smart meter
              </span>
            </label>
            <input
              type="text"
              placeholder="Enter your service address..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white border-2 border-brand-navy text-brand-navy placeholder-brand-navy/40 focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue transition-all duration-300 shadow-sm"
            />
          </div>

          <label className="flex items-start space-x-3 text-sm cursor-pointer group">
            <input 
              type="checkbox" 
              checked={consent} 
              onChange={() => setConsent(!consent)}
              className="mt-1 w-4 h-4 text-brand-blue bg-white border-brand-navy rounded focus:ring-brand-blue focus:ring-2"
            />
            <span className="text-brand-navy group-hover:text-brand-blue transition-colors">
              I agree to allow IntelliWatt to securely access my Smart Meter Texas data for automatic plan optimization and savings calculations.
            </span>
          </label>

          <button
            onClick={handleConnect}
            disabled={status === 'connecting'}
            className="w-full bg-brand-navy text-brand-blue font-bold py-4 px-6 rounded-xl border-2 border-brand-navy hover:border-brand-blue hover:text-brand-blue hover:bg-brand-navy transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'connecting' ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-brand-blue" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Connecting...
              </span>
            ) : (
              'Connect My Smart Meter →'
            )}
          </button>
        </div>

        <div className="text-center mt-6 pt-6 border-t border-brand-navy/30">
          <p className="text-sm text-brand-navy mb-2">Prefer to enter details manually?</p>
          <button
            onClick={async () => {
              setStatus('manual');
              if (manualAwarded) {
                return;
              }
              try {
                const manualResponse = await fetch('/api/user/manual-usage', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ...(houseId ? { houseId } : {}),
                  }),
                });

                if (!manualResponse.ok) {
                  throw new Error('Unable to record manual usage');
                }

                const manualData = await manualResponse.json();

                const entryResponse = await fetch('/api/user/entries', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    type: 'smart_meter_connect',
                    amount: 1,
                    manualUsageId: manualData.id,
                    ...(houseId ? { houseId } : {}),
                  }),
                });

                if (!entryResponse.ok) {
                  throw new Error('Unable to award manual entry');
                }

                setManualAwarded(true);
                window.dispatchEvent(new CustomEvent('entriesUpdated'));
              } catch (error) {
                console.error('Error awarding manual smart meter entries:', error);
                alert('We could not record your manual entry right now. Please try again.');
              }
            }}
            className="text-brand-blue underline hover:text-brand-white transition-colors font-medium"
          >
            Enter Smart Meter Details Manually
          </button>
        </div>
      </div>
    </section>
  );
} 