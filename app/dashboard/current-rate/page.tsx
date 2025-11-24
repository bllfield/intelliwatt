"use client";

import { CurrentRateDetailsForm } from "@/components/CurrentRateDetailsForm";

export default function CurrentRatePage() {
  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <CurrentRateDetailsForm
        onContinue={(data) => {
          console.log("Current rate details submitted:", data);
        }}
        onSkip={() => {
          console.log("Current rate details skipped; proceed to plan analyzer.");
        }}
      />
    </main>
  );
}
