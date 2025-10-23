export default function AnalysisPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-brand-navy">📈 Energy Analysis</h1>
      <div className="bg-white p-8 rounded-2xl border border-brand-blue/20 shadow-lg">
        <div className="text-center">
          <div className="text-6xl mb-4">🔬</div>
          <h2 className="text-2xl font-bold text-brand-navy mb-4">Coming Soon</h2>
          <p className="text-brand-slate text-lg mb-6">
            Once everything is connected, you'll see breakdowns of your usage, plan performance, cost savings, and optimization suggestions.
          </p>
          <div className="bg-gradient-to-r from-brand-blue/10 to-brand-cyan/10 p-6 rounded-xl border border-brand-blue/20">
            <h3 className="text-lg font-semibold text-brand-navy mb-3">Planned Features</h3>
            <ul className="text-brand-slate space-y-2 text-left max-w-md mx-auto">
              <li className="flex items-center space-x-2">
                <span className="text-brand-blue">•</span>
                <span>Usage breakdown by time and appliance</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-brand-blue">•</span>
                <span>Plan performance and cost savings</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-brand-blue">•</span>
                <span>Optimization suggestions</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-brand-blue">•</span>
                <span>Solar and battery simulation</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
} 