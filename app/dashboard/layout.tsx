import IdleGuard from '@/components/IdleGuard';
import EntriesChecklistSidebar from '@/components/dashboard/EntriesChecklistSidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <IdleGuard>
      <div className="min-h-screen bg-brand-white text-brand-navy">
        <EntriesChecklistSidebar />
        <div className="flex flex-col min-w-0">
          <main className="flex-1 p-6 max-w-6xl mx-auto w-full">{children}</main>
        </div>
      </div>
    </IdleGuard>
  );
} 