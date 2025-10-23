export default function UpgradesPage() {
  return (
    <main className="max-w-3xl mx-auto p-6 text-white">
      <h1 className="text-3xl font-bold mb-4">💡 Upgrade Recommendations</h1>
      <p className="text-brand-cyan mb-6">
        Coming soon: IntelliWatt will analyze all your connected energy data to recommend
        the most cost-effective upgrades to reduce your energy usage and save you money.
      </p>
      <ul className="list-disc list-inside space-y-2">
        <li>🧱 Compare insulation, HVAC, appliance, and window upgrades</li>
        <li>⚡ Simulate solar panel + battery options vs. utility rates</li>
        <li>📉 Show total savings, payback time, and new estimated bills</li>
        <li>📬 Results may be delivered via email or text — not shown in this dashboard</li>
      </ul>
      <p className="mt-6 text-sm text-gray-300">
        This tool will use your real usage patterns, home details, appliance efficiency, and utility plan
        to generate fully personalized energy upgrade paths — and recommend only what saves you more than it costs.
      </p>
    </main>
  );
} 