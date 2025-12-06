"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QuickAddressEntry from "@/components/QuickAddressEntry";

type ActiveHouse = {
  id: string;
  formattedAddress: string;
};

type Props = {
  activeHouse?: ActiveHouse | null;
};

export function ProfileInlineAddressChange({ activeHouse = null }: Props) {
  const router = useRouter();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (!activeHouse) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-2xl border border-amber-400/40 bg-amber-500/5 p-4 text-brand-cyan">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Change service address</p>
        <p className="text-sm text-brand-cyan/80">
          Updating your address will archive the prior Smart Meter Texas authorization tied to this home. You
will need to reconnect SMT after saving to keep usage in sync.
        </p>
      </div>
      <QuickAddressEntry
        onAddressSubmitted={() => setStatusMessage(null)}
        userAddress={activeHouse.formattedAddress ?? ""}
        redirectOnSuccess={false}
        onSaveResult={(data) => {
          if (data?.ok === false && data?.message) {
            setStatusMessage(data.message);
            return;
          }
          setStatusMessage("Address updated. Reconnect SMT for the new location.");
          router.refresh();
        }}
        houseIdForSave={activeHouse.id}
        keepOtherHouses={false}
        heading="Change service address"
        subheading="Enter your current service address. This replaces the existing one."
        helperText="Saving here archives the previous SMT authorization for this home."
        submitLabel="Change address"
        className="border-brand-cyan/40 bg-brand-navy/90 text-brand-cyan"
      />
      {statusMessage ? (
        <div className="rounded-lg border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-2 text-xs text-brand-cyan">
          {statusMessage}
        </div>
      ) : null}
    </div>
  );
}
