export default function ManualEntryPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-brand-navy">📄 Manual Data Entry</h1>
      
      <div className="bg-white p-8 rounded-2xl border border-brand-blue/20 shadow-lg">
        <div className="text-center">
          <div className="text-6xl mb-4">📊</div>
          <h2 className="text-2xl font-bold text-brand-navy mb-4">Coming Soon</h2>
          <p className="text-brand-slate text-lg mb-6">
            Manually enter your energy usage data for analysis and recommendations.
          </p>
          
          <div className="bg-gradient-to-r from-brand-blue/10 to-brand-cyan/10 p-6 rounded-xl border border-brand-blue/20">
            <h3 className="text-lg font-semibold text-brand-navy mb-3">What You'll Be Able To Do</h3>
            <ul className="text-brand-slate space-y-2 text-left max-w-md mx-auto">
              <li className="flex items-center space-x-2">
                <span className="text-brand-navy">•</span>
                <span>Upload energy bills as PDFs</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-brand-navy">•</span>
                <span>Enter monthly usage data manually</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-brand-navy">•</span>
                <span>Track usage patterns over time</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-brand-navy">•</span>
                <span>Get personalized recommendations</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
} 