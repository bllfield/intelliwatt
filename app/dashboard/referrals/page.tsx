export default function ReferralsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-brand-navy">📣 Referral Tracker</h1>
      
      <div className="bg-white p-8 rounded-2xl border border-brand-blue/20 shadow-lg">
        <div className="text-center">
          <div className="text-6xl mb-4">🚧</div>
          <h2 className="text-2xl font-bold text-brand-navy mb-4">Coming Soon</h2>
          <p className="text-brand-slate text-lg mb-6">
            Our referral system is being built to help you earn Jackpot entries by inviting friends to IntelliWatt.
          </p>
          
          <div className="bg-gradient-to-r from-brand-blue/10 to-brand-cyan/10 p-6 rounded-xl border border-brand-blue/20">
            <h3 className="text-lg font-semibold text-brand-navy mb-3">How It Will Work</h3>
            <ul className="text-brand-slate space-y-2 text-left max-w-md mx-auto">
              <li className="flex items-center space-x-2">
                <span className="text-brand-blue">•</span>
                <span>Get a unique referral link</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-brand-blue">•</span>
                <span>Share with friends and family</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-brand-blue">•</span>
                <span>Earn 5+ entries for each successful referral</span>
              </li>
              <li className="flex items-center space-x-2">
                <span className="text-brand-blue">•</span>
                <span>Track your referral success in real-time</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
} 