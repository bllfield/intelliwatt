import { CurrentRateDetailsForm } from "@/components/CurrentRateDetailsForm";

export default function CurrentRateDetailsPage() {
  function handleContinue(data: {
    planName: string;
    primaryRateCentsPerKwh: string;
    baseFeeDollars: string;
    contractExpiration: string;
    notes: string;
    hasUpload: boolean;
  }) {
    // TODO: In a future step, persist current-plan details, award jackpot entries,
    // and feed them into the Plan Analyzer pipeline.
    console.log("Current rate details submitted:", data);
  }

  function handleSkip() {
    // TODO: Route directly to plan results when flow wiring is implemented.
    console.log("Current rate details skipped; proceed to plan analyzer.");
  }

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <CurrentRateDetailsForm onContinue={handleContinue} onSkip={handleSkip} />
    </main>
  );
}

