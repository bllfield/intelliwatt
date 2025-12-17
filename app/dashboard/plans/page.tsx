import DashboardHero from "@/components/dashboard/DashboardHero";
import PlansClient from "./PlansClient";

export default function PlansPage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Energy"
        highlight="Plans"
        description="See current WattBuy EFL averages and whether IntelliWatt calculations are available for each offer."
      />

      <section className="bg-brand-white pt-2 pb-10 px-4">
        <div className="mx-auto w-full max-w-6xl">
          <PlansClient />
        </div>
      </section>
    </div>
  );
}