// app/quote/page.tsx
// Step 38: Quotes page wrapper — mounts <QuoteWidget/> and supports query-string prefill
//  - URL examples:
//      /quote
//      /quote?address=8808%20Las%20Vegas%20Ct&city=White%20Settlement&state=TX&zip=76108&kwh=1200
//  - This page is safe to drop into your existing Next.js App Router site without breaking anything.

import QuoteWidget from '@/components/quotes/QuoteWidget';

export const dynamic = 'force-dynamic';

type SearchParams = {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  kwh?: string | number;
};

export default function QuotePage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const sp = searchParams || {};
  const kwhNum =
    typeof sp.kwh === 'string'
      ? Math.max(0, Number(sp.kwh) || 0)
      : typeof sp.kwh === 'number'
      ? Math.max(0, sp.kwh)
      : undefined;

  return (
    <main className="min-h-screen w-full bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Compare electricity plans</h1>
          <p className="text-gray-600 mt-1">
            Enter your Texas address and a monthly usage estimate to see current plans and estimated monthly costs.
          </p>
        </header>

        <QuoteWidget
          defaultAddress={{
            address: (sp.address || '').toString(),
            city: (sp.city || '').toString(),
            state: (sp.state || 'TX').toString().toUpperCase(),
            zip: (sp.zip || '').toString(),
          }}
          defaultKwh={kwhNum ?? 1000}
          className="bg-white"
        />
      </div>
    </main>
  );
}