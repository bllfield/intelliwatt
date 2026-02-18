'use client';

import { useRouter } from 'next/navigation';

type Props = {
  houseAddressId?: string | null;
};

export default function SmtManualFallbackCard({ houseAddressId = null }: Props) {
  const router = useRouter();

  return (
    <div className="rounded-3xl border-2 border-brand-blue bg-brand-navy px-5 py-5 text-sm text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)] sm:px-6 sm:py-6">
      <p className="font-semibold uppercase tracking-wide text-brand-cyan">Manual Usage</p>
      <p className="mt-2 text-brand-cyan/80">
        Enter monthly or annual kWh totals to generate a simulated 15-minute usage curve. This never modifies SMT or Green
        Button data.
      </p>
      <button
        type="button"
        onClick={() => router.push('/dashboard/usage/simulated#start-here')}
        className="mt-4 inline-flex items-center rounded-full border border-brand-blue px-5 py-2 text-xs font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue/70 hover:bg-brand-blue/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Enter manual usage
      </button>
    </div>
  );
}


