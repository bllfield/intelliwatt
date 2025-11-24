import IdleGuard from '@/components/IdleGuard';
import DashboardHeader from '@/components/DashboardHeader';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <IdleGuard>
      <div className="min-h-screen bg-brand-white text-brand-navy">
        {/* Main Content Area */}
        <div className="flex flex-col min-w-0">
          <DashboardHeader />
          
          <main className="flex-1 p-6 max-w-6xl mx-auto w-full">{children}</main>
          
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
      </div>
    </IdleGuard>
  );
} 