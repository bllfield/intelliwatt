export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-brand-white text-brand-navy">
      <header className="px-4 py-2 bg-brand-navy text-brand-blue font-bold shadow-lg border-b border-brand-blue/20">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <a href="/dashboard" className="text-xl font-bold text-brand-blue hover:text-brand-white transition-colors">Dashboard</a>
          </div>
          <nav className="hidden md:flex space-x-6 text-sm">
            <a href="/dashboard/entries" className="text-brand-blue hover:text-brand-white transition-colors">Entries</a>
            <a href="/dashboard/plans" className="text-brand-blue hover:text-brand-white transition-colors">Plans</a>
            <a href="/dashboard/home" className="text-brand-blue hover:text-brand-white transition-colors">Home Info</a>
            <a href="/dashboard/appliances" className="text-brand-blue hover:text-brand-white transition-colors">Appliances</a>
            <a href="/dashboard/api" className="text-brand-blue hover:text-brand-white transition-colors">API Connect</a>
            <a href="/dashboard/analysis" className="text-brand-blue hover:text-brand-white transition-colors">Analysis</a>
            <a href="/dashboard/manual-entry" className="text-brand-blue hover:text-brand-white transition-colors">Manual Entry</a>
            <a href="/dashboard/usage" className="text-brand-blue hover:text-brand-white transition-colors">Usage</a>
            <a href="/dashboard/referrals" className="text-brand-blue hover:text-brand-white transition-colors">Referrals</a>
            <a href="/dashboard/upgrades" className="text-brand-blue hover:text-brand-white transition-colors">Upgrades</a>
          </nav>
          <div className="md:hidden">
            <span className="text-sm text-brand-blue">Menu</span>
          </div>
        </div>
      </header>
      <main className="p-6 max-w-6xl mx-auto">{children}</main>
      <footer className="mt-12 text-center py-6 bg-brand-navy text-brand-blue text-sm shadow-lg border-t border-brand-blue/20">
        <div className="max-w-6xl mx-auto">
          <div className="space-x-6 mb-4">
            <a href="/dashboard/entries" className="text-brand-blue hover:text-brand-white transition-colors">Entries</a>
            <a href="/dashboard/plans" className="text-brand-blue hover:text-brand-white transition-colors">Plans</a>
            <a href="/dashboard/home" className="text-brand-blue hover:text-brand-white transition-colors">Home Info</a>
            <a href="/dashboard/appliances" className="text-brand-blue hover:text-brand-white transition-colors">Appliances</a>
            <a href="/dashboard/api" className="text-brand-blue hover:text-brand-white transition-colors">API</a>
            <a href="/dashboard/analysis" className="text-brand-blue hover:text-brand-white transition-colors">Analysis</a>
            <a href="/dashboard/upgrades" className="text-brand-blue hover:text-brand-white transition-colors">Upgrades</a>
          </div>
          <p className="mt-4 text-brand-blue">© 2025 IntelliWatt™. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
} 