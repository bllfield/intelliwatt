export default function RulesPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
      </div>

      <main className="relative max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold mb-6 text-brand-blue">📜 Official Rules – HitTheJackWatt</h1>
        
        <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 backdrop-blur-sm">
          <div className="text-brand-white space-y-6">
            <p className="text-lg">
              This is where you'll paste your official sweepstakes terms from the HTJW rules document.
            </p>
            
            <div className="bg-brand-navy/50 p-6 rounded-xl border border-brand-blue/20">
              <h2 className="text-2xl font-semibold mb-4 text-brand-blue">Coming Soon</h2>
              <p className="text-brand-cyan">
                Official HitTheJackWatt sweepstakes rules and terms will be posted here once finalized. 
                Check back soon for complete contest details, eligibility requirements, and prize information.
              </p>
            </div>
            
            <div className="mt-8 p-4 bg-brand-blue/10 rounded-lg border border-brand-blue/20">
              <p className="text-sm text-brand-cyan">
                <strong>Note:</strong> All sweepstakes entries are subject to official rules and eligibility requirements. 
                Void where prohibited by law.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 