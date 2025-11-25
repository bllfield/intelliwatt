'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import QuickAddressEntry from '@/components/QuickAddressEntry';
import SmtManualFallbackCard from '@/components/smt/SmtManualFallbackCard';

type Props = {
  houseAddressId?: string | null;
  initialAddress?: string | null;
};

export default function SmtAddressCaptureCard({ houseAddressId = null, initialAddress = null }: Props) {
  const router = useRouter();
  const [savedAddress, setSavedAddress] = useState(initialAddress ?? '');
  const [addressReady, setAddressReady] = useState(Boolean(initialAddress && initialAddress.trim().length > 0));

  if (addressReady) {
    return null;
  }

  return (
    <div className="space-y-6">
      <QuickAddressEntry
        onAddressSubmitted={(value) => {
          const next = value ?? '';
          setSavedAddress(next);
          const ready = Boolean(next && next.trim().length > 0);
          setAddressReady(ready);
          if (ready) {
            router.refresh();
          }
        }}
        userAddress={savedAddress || undefined}
        redirectOnSuccess={false}
        houseIdForSave={houseAddressId ?? null}
        keepOtherHouses={false}
        heading="Service address"
        subheading="Save the address you want IntelliWatt to analyze. We’ll automatically sync the correct utility and ESIID."
        helperText="Need to switch homes later? Update the address here first, then reconnect Smart Meter Texas."
        submitLabel="Save service address"
      />

    </div>
  );
}
