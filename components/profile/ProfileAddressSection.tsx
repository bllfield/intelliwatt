'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import QuickAddressEntry from '@/components/QuickAddressEntry';

type Props = {
  formattedAddress?: string | null;
  esiid?: string | null;
  utilityName?: string | null;
};

export function ProfileAddressSection({ formattedAddress, esiid, utilityName }: Props) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [addressDisplay, setAddressDisplay] = useState(formattedAddress ?? '');
  const [metaWarning, setMetaWarning] = useState<string | null>(null);

  const handleAddressSaved = (data: any) => {
    const warningText =
      data?.meta?.previousAuthorizationArchived === true
        ? 'Your previous Smart Meter Texas authorization has been archived. Connect this address to continue syncing usage.'
        : null;

    setMetaWarning(warningText);
    router.refresh();
    setIsEditing(false);
    setShowModal(true);
  };

  return (
    <section className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/80 p-6 shadow-[0_18px_50px_rgba(16,46,90,0.35)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold uppercase tracking-wide text-brand-cyan">
            Service address
          </h2>
          <p className="mt-1 text-xs text-brand-cyan/70">
            Updating your address immediately retires the prior house and SMT authorization.
          </p>
        </div>
        <button
          onClick={() => {
            setMetaWarning(null);
            setIsEditing((prev) => !prev);
          }}
          className="inline-flex items-center rounded-full border border-brand-cyan/60 bg-brand-cyan/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-blue hover:text-brand-blue"
        >
          {isEditing ? 'Cancel' : 'Change address'}
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-brand-cyan/40 bg-brand-navy/60 p-4 text-sm text-brand-cyan">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/70">
            Current address
          </p>
          <pre className="mt-2 whitespace-pre-line text-sm text-brand-cyan/90">
            {addressDisplay || 'No address on file'}
          </pre>
        </div>
        <div className="rounded-2xl border border-brand-cyan/40 bg-brand-navy/60 p-4 text-sm text-brand-cyan">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/70">
            Utility details
          </p>
          <div className="mt-2 space-y-1 text-sm text-brand-cyan/90">
            <div>
              <span className="font-semibold">Utility · </span>
              {utilityName ?? 'Unknown'}
            </div>
            <div>
              <span className="font-semibold">ESIID · </span>
              {esiid ?? 'Not available'}
            </div>
          </div>
        </div>
      </div>

      {metaWarning ? (
        <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
          {metaWarning}
        </div>
      ) : null}

      {isEditing ? (
        <div className="mt-6 space-y-4 rounded-2xl border border-brand-cyan/40 bg-brand-navy/60 p-5">
          <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
            Saving a new address immediately archives your previous Smart Meter Texas agreement. You’ll
            need to reconnect SMT for the new service address.
          </div>
          <QuickAddressEntry
            onAddressSubmitted={(value) => setAddressDisplay(value)}
            userAddress=""
            redirectOnSuccess={false}
            onSaveResult={handleAddressSaved}
          />
        </div>
      ) : null}

      {showModal ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-3xl border border-brand-cyan/40 bg-brand-navy p-6 text-center shadow-[0_24px_60px_rgba(16,46,90,0.5)]">
            <h3 className="text-lg font-semibold text-brand-cyan">
              Connect your new address to Smart Meter Texas
            </h3>
            <p className="mt-3 text-sm text-brand-cyan/80">
              We archived your previous authorization. Head to the API connect page to authorize your
              new service address.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-full border border-brand-cyan/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-blue hover:text-brand-blue"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowModal(false);
                  router.push('/dashboard/api#smt');
                }}
                className="rounded-full border border-brand-blue bg-brand-blue px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-navy transition hover:bg-brand-blue/90"
              >
                Connect to SMT
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

