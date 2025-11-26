'use client';

import { useCallback, useEffect, useState } from 'react';
import QuickAddressEntry from '@/components/QuickAddressEntry';

type SmartMeterSectionProps = {
  houseId?: string | null;
};

type AuthorizationSummary = {
  id: string;
  esiid: string | null;
  meterNumber: string | null;
  authorizationEndDate: string | null;
  tdspName: string | null;
  emailConfirmationStatus: 'PENDING' | 'APPROVED' | 'DECLINED';
  emailConfirmationAt: string | null;
  houseAddress: {
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    zip5: string;
  } | null;
};

export default function SmartMeterSection({ houseId }: SmartMeterSectionProps) {
  const [mounted, setMounted] = useState(false);
  const [address, setAddress] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'manual'>('idle');
  const [showAwardModal, setShowAwardModal] = useState(false);
  const [showEmailReminder, setShowEmailReminder] = useState(false);
  const [manualAwarded, setManualAwarded] = useState(false);
  const [authorizationInfo, setAuthorizationInfo] = useState<AuthorizationSummary | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [emailConfirmationSubmitting, setEmailConfirmationSubmitting] = useState<
    'idle' | 'approved' | 'declined'
  >('idle');
  const [emailConfirmationError, setEmailConfirmationError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    if (!showEmailReminder) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showEmailReminder]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchAuthorizationStatus = useCallback(async () => {
    try {
      setCheckingStatus(true);
      const response = await fetch('/api/user/smt/status', { cache: 'no-store' });
      if (!response.ok) {
        setAuthorizationInfo(null);
        setStatus('idle');
        return;
      }
      const payload = await response.json();
      if (payload.connected) {
        setAuthorizationInfo(payload.authorization as AuthorizationSummary);
        setStatus('connected');
      } else {
        setAuthorizationInfo(null);
        setStatus('idle');
      }
    } catch (error) {
      console.error('Failed to load SMT authorization status', error);
      setAuthorizationInfo(null);
      setStatus('idle');
    } finally {
      setCheckingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    fetchAuthorizationStatus();
  }, [mounted, fetchAuthorizationStatus]);

  useEffect(() => {
    if (!authorizationInfo || status !== 'connected') {
      setShowEmailReminder(false);
      return;
    }

    setShowEmailReminder(authorizationInfo.emailConfirmationStatus === 'PENDING');
  }, [authorizationInfo, status]);

  const formattedAddress = authorizationInfo?.houseAddress
    ? [
        authorizationInfo.houseAddress.line1,
        authorizationInfo.houseAddress.line2,
        `${authorizationInfo.houseAddress.city}, ${authorizationInfo.houseAddress.state} ${authorizationInfo.houseAddress.zip5}`,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

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
      await fetchAuthorizationStatus();
    } else {
      setStatus('idle');
      alert('Something went wrong connecting your Smart Meter.');
    }
  };

  const handleEmailConfirmationChoice = useCallback(
    async (choice: 'approved' | 'declined') => {
      if (emailConfirmationSubmitting !== 'idle') {
        return;
      }

      setEmailConfirmationSubmitting(choice);
      setEmailConfirmationError(null);

      try {
        const response = await fetch('/api/user/smt/email-confirmation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: choice }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: 'Unable to record confirmation status' }));
          throw new Error(data?.error ?? 'Unable to record confirmation status');
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('entriesUpdated'));
        }

        await fetchAuthorizationStatus();
        setShowEmailReminder(false);
      } catch (error) {
        console.error('Failed to update SMT email confirmation status', error);
        setEmailConfirmationError(
          error instanceof Error ? error.message : 'We could not record your response right now. Please try again.',
        );
      } finally {
        setEmailConfirmationSubmitting('idle');
      }
    },
    [emailConfirmationSubmitting, fetchAuthorizationStatus],
  );

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted || checkingStatus) {
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

  if (status === 'connected' && authorizationInfo) {
    return (
      <section className="bg-gradient-to-r from-green-600 to-green-700 text-white p-6 rounded-2xl shadow-lg mb-6 border border-green-500/20">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
              <span className="text-xl">✅</span>
            </div>
            <div>
              <h2 className="text-2xl font-bold">Smart Meter Connected!</h2>
              <p className="text-sm text-green-100">
                Your usage, plan, and ESIID data are now loaded into your dashboard.
              </p>
            </div>
          </div>

          <div className="grid gap-4 rounded-2xl border border-white/20 bg-white/10 p-4 text-sm text-green-50 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-green-200">Service address</p>
              <pre className="mt-2 whitespace-pre-line font-sans text-sm leading-tight">
                {formattedAddress}
              </pre>
            </div>
            <div className="grid gap-2">
              {authorizationInfo.esiid ? (
                <p>
                  <span className="font-semibold">ESIID · </span>
                  {authorizationInfo.esiid}
                </p>
              ) : null}
              {authorizationInfo.meterNumber ? (
                <p>
                  <span className="font-semibold">Meter · </span>
                  {authorizationInfo.meterNumber}
                </p>
              ) : null}
              {authorizationInfo.tdspName ? (
                <p>
                  <span className="font-semibold">Utility · </span>
                  {authorizationInfo.tdspName}
                </p>
              ) : null}
              {authorizationInfo.authorizationEndDate ? (
                <p>
                  <span className="font-semibold">Authorization valid until · </span>
                  {new Date(authorizationInfo.authorizationEndDate).toLocaleDateString()}
                </p>
              ) : null}
              <p
                className={
                  authorizationInfo.emailConfirmationStatus === 'DECLINED'
                    ? 'font-semibold text-rose-200'
                    : authorizationInfo.emailConfirmationStatus === 'APPROVED'
                    ? 'text-emerald-200'
                    : 'text-brand-cyan/70'
                }
              >
                <span className="font-semibold">Email confirmation · </span>
                {authorizationInfo.emailConfirmationStatus === 'APPROVED'
                  ? `Approved${
                      authorizationInfo.emailConfirmationAt
                        ? ` ${new Date(authorizationInfo.emailConfirmationAt).toLocaleDateString()}`
                        : ''
                    }`
                  : authorizationInfo.emailConfirmationStatus === 'DECLINED'
                  ? `Declined${
                      authorizationInfo.emailConfirmationAt
                        ? ` ${new Date(authorizationInfo.emailConfirmationAt).toLocaleDateString()}`
                        : ''
                    }`
                  : 'Pending customer action'}
              </p>
            </div>
          </div>
        </div>

        {showAwardModal && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
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
              <p className="mb-4">
                You just earned <span className="font-bold" style={{ color: '#39FF14' }}>1 jackpot entry</span> for connecting your smart meter.
              </p>
              <a href="/dashboard/home" className="inline-block bg-brand-navy text-brand-blue font-bold py-2 px-4 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">Add Home Details →</a>
              <button onClick={() => setShowAwardModal(false)} className="ml-3 inline-block text-sm underline">Dismiss</button>
            </div>
          </div>
        )}

        {showEmailReminder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-xl rounded-3xl border border-brand-blue/40 bg-brand-navy p-6 text-brand-cyan shadow-[0_24px_60px_rgba(16,46,90,0.55)]">
              <h3 className="text-lg font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
                Check your inbox — action required
              </h3>
              <p className="mt-4 text-sm leading-relaxed text-brand-cyan/80">
                We just asked Smart Meter Texas to authorize IntelliWatt. Look for an email from{' '}
                <span className="font-semibold text-brand-cyan">info@communications.smartmetertexas.com</span> with the
                subject “Authorization to allow Intelliwatt to access your electricity information”.
              </p>
              <ul className="mt-4 space-y-3 rounded-2xl border border-brand-blue/30 bg-brand-blue/5 px-4 py-3 text-sm text-brand-cyan/85">
                <li>
                  • Open the email and click <span className="font-semibold text-brand-cyan">Confirm</span> to approve the
                  request before it expires.
                </li>
                <li>
                  • If you did not expect the request, choose <span className="font-semibold text-brand-cyan">Did Not Request</span>{' '}
                  or contact support immediately.
                </li>
                <li>
                  • You can always revoke this authorization later from your IntelliWatt profile.
                </li>
              </ul>
              <p className="mt-4 text-xs uppercase tracking-wide text-brand-cyan/60">
                Tell us what happened after you reviewed the email so we can keep your rewards accurate.
              </p>
              {emailConfirmationError ? (
                <p className="mt-4 rounded-lg border border-rose-400/40 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                  {emailConfirmationError}
                </p>
              ) : null}
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => handleEmailConfirmationChoice('declined')}
                  disabled={emailConfirmationSubmitting !== 'idle'}
                  className="inline-flex items-center justify-center rounded-full border border-rose-400/60 bg-rose-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-200 transition hover:border-rose-300 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {emailConfirmationSubmitting === 'declined' ? 'Recording…' : 'I declined or revoked the request'}
                </button>
                <button
                  type="button"
                  onClick={() => handleEmailConfirmationChoice('approved')}
                  disabled={emailConfirmationSubmitting !== 'idle'}
                  className="inline-flex items-center justify-center rounded-full border border-brand-cyan/60 bg-brand-cyan/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-blue hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {emailConfirmationSubmitting === 'approved' ? 'Saving…' : 'I approved the email from SMT'}
                </button>
              </div>
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

      <div className="space-y-6">
        <QuickAddressEntry
          onAddressSubmitted={(value) => {
            setAddress(value);
            if (!value) {
              setConsent(false);
            }
          }}
          userAddress={address || undefined}
          redirectOnSuccess={false}
          keepOtherHouses={false}
          saveMode="capture"
          heading="Service address"
          subheading="Confirm the service address tied to your electric account so IntelliWatt can submit the correct Smart Meter request."
          helperText="If you moved recently, update the Profile page first so your address stays in sync."
          submitLabel="Use this address"
        />

        <label className="flex items-start gap-3 rounded-2xl border border-brand-navy/20 bg-brand-navy/5 px-4 py-3 text-sm text-brand-navy">
          <input
            type="checkbox"
            checked={consent}
            onChange={() => setConsent(!consent)}
            className="mt-1 h-4 w-4 rounded border-brand-navy text-brand-blue focus:ring-2 focus:ring-brand-blue"
          />
          <span>
            I agree to allow IntelliWatt to securely access my Smart Meter Texas data for automatic plan optimization and savings calculations.
          </span>
        </label>

        <button
          onClick={handleConnect}
          disabled={status === 'connecting'}
          className="w-full rounded-full border-2 border-brand-navy bg-brand-navy py-4 text-sm font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === 'connecting' ? 'Connecting…' : 'Connect my smart meter'}
        </button>

        <div className="rounded-2xl border border-brand-navy/20 bg-brand-navy/5 px-4 py-3 text-center text-sm text-brand-navy">
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
            className="text-brand-blue underline hover:text-brand-navy transition-colors font-medium"
          >
            Enter Smart Meter details manually
          </button>
        </div>
      </div>
    </section>
  );
} 