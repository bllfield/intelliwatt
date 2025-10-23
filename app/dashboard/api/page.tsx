export default function ApiConnectPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-3xl font-bold mb-6 text-brand-navy">🔌 Smart Device & Smart Meter Connect</h2>
      
      <div className="bg-white p-8 rounded-2xl border border-brand-blue/20 shadow-lg mb-8">
        <p className="text-brand-slate text-lg mb-6">
          Connect your energy data sources to get real-time insights. You'll earn entries for each integration.
        </p>
        
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="p-6 bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 rounded-xl border border-brand-blue/20">
            <h3 className="text-xl font-semibold text-brand-navy mb-3">Smart Meter Texas (SMT)</h3>
            <p className="text-brand-slate mb-4">Connect directly to your utility's smart meter for automatic data collection.</p>
            <button className="bg-brand-blue text-brand-navy font-bold px-4 py-2 rounded-lg hover:bg-brand-cyan transition-colors">
              Connect SMT
            </button>
          </div>
          
          <div className="p-6 bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 rounded-xl border border-brand-blue/20">
            <h3 className="text-xl font-semibold text-brand-navy mb-3">Smart Home Devices</h3>
            <p className="text-brand-slate mb-4">Connect your Emporia Vue, Sense, Nest, Tesla, or Enphase devices.</p>
            <button className="bg-brand-blue text-brand-navy font-bold px-4 py-2 rounded-lg hover:bg-brand-cyan transition-colors">
              Connect Devices
            </button>
          </div>
        </div>
        
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800 text-sm">
            <strong>Coming soon:</strong> Secure OAuth logins and synced device APIs for seamless data integration.
          </p>
        </div>
      </div>
      
      <div className="bg-gradient-to-r from-brand-blue to-brand-cyan p-6 rounded-2xl text-center">
        <h3 className="text-brand-navy font-bold text-lg mb-2">Earn Entries</h3>
        <p className="text-brand-navy">Each successful connection earns you Jackpot entries!</p>
      </div>
    </div>
  );
} 