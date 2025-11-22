'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  email: string;
  createdAt: string;
  entries?: any[];
  referrals?: any[];
}

interface Commission {
  id: string;
  userId: string;
  type: string;
  amount: number;
  status: string;
  user?: User;
}

interface JackpotPayout {
  id: string;
  userId: string;
  amount: number;
  paid: boolean;
  user?: User;
}

interface FinanceRecord {
  id: string;
  type: string;
  source: string;
  amount: number;
  status: string;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adminEmail, setAdminEmail] = useState('admin@intelliwatt.com');
  
  // Real data state
  const [users, setUsers] = useState<User[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [jackpotPayouts, setJackpotPayouts] = useState<JackpotPayout[]>([]);
  const [financeRecords, setFinanceRecords] = useState<FinanceRecord[]>([]);

  // Fetch real data from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [usersRes, commissionsRes, jackpotRes, financeRes] = await Promise.all([
          fetch('/api/admin/users'),
          fetch('/api/admin/commissions'),
          fetch('/api/admin/jackpot'),
          fetch('/api/admin/finance')
        ]);

        if (usersRes.ok) {
          const usersData = await usersRes.json();
          console.log('Fetched users data:', usersData);
          setUsers(usersData);
        } else {
          console.error('Failed to fetch users:', usersRes.status, usersRes.statusText);
        }

        if (commissionsRes.ok) {
          const commissionsData = await commissionsRes.json();
          console.log('Fetched commissions data:', commissionsData);
          setCommissions(commissionsData);
        } else {
          console.error('Failed to fetch commissions:', commissionsRes.status, commissionsRes.statusText);
        }

        if (jackpotRes.ok) {
          const jackpotData = await jackpotRes.json();
          console.log('Fetched jackpot data:', jackpotData);
          setJackpotPayouts(jackpotData);
        } else {
          console.error('Failed to fetch jackpot:', jackpotRes.status, jackpotRes.statusText);
        }

        if (financeRes.ok) {
          const financeData = await financeRes.json();
          console.log('Fetched finance data:', financeData);
          setFinanceRecords(financeData);
        } else {
          console.error('Failed to fetch finance:', financeRes.status, financeRes.statusText);
        }
      } catch (error) {
        console.error('Error fetching admin data:', error);
      }
    };

    setMounted(true);
    document.title = 'Admin Dashboard - IntelliWatt™';
    
    fetchData().finally(() => {
      setLoading(false);
    });
  }, []);

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-navy flex items-center justify-center">
        <div className="text-brand-white text-xl">Loading Admin Dashboard...</div>
      </div>
    );
  }

  const totalCommissions = commissions.reduce((sum, r) => sum + r.amount, 0);
  const pendingJackpot = jackpotPayouts.filter(j => !j.paid).length;
  const totalFinance = financeRecords.reduce((sum, f) => sum + (f.type === 'income' ? f.amount : -f.amount), 0);

  return (
    <div className="min-h-screen bg-brand-navy">
      {/* Header */}
      <div className="bg-brand-navy border-b border-brand-blue/20">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-brand-white">Admin Dashboard</h1>
            <div className="text-brand-blue">Logged in as: {adminEmail}</div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats Overview */}
        <div className="grid md:grid-cols-4 gap-6 mb-8">
          <div className="bg-brand-white rounded-lg p-6 shadow-lg">
            <div className="text-2xl font-bold text-brand-navy">{users.length}</div>
            <div className="text-brand-navy/60">Total Users</div>
          </div>
          <div className="bg-brand-white rounded-lg p-6 shadow-lg">
            <div className="text-2xl font-bold text-brand-navy">${totalCommissions.toFixed(2)}</div>
            <div className="text-brand-navy/60">Total Commissions</div>
          </div>
          <div className="bg-brand-white rounded-lg p-6 shadow-lg">
            <div className="text-2xl font-bold text-brand-navy">{pendingJackpot}</div>
            <div className="text-brand-navy/60">Pending Jackpot Payouts</div>
          </div>
          <div className="bg-brand-white rounded-lg p-6 shadow-lg">
            <div className="text-2xl font-bold text-brand-navy">${totalFinance.toFixed(2)}</div>
            <div className="text-brand-navy/60">Net Finance</div>
          </div>
        </div>

        {/* Quick Links / Tools Section */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">🔧 Admin Tools</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <a
              href="/admin/wattbuy/inspector"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🔍 WattBuy Inspector</div>
              <div className="text-sm text-brand-navy/60">Test electricity, retail rates, and offers endpoints with real-time metadata</div>
            </a>
            <a
              href="/admin/smt/inspector"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">📊 SMT Inspector</div>
              <div className="text-sm text-brand-navy/60">Test SMT ingest, upload, and health endpoints</div>
            </a>
            <a
              href="/admin/ercot/inspector"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">⚡ ERCOT ESIID</div>
              <div className="text-sm text-brand-navy/60">View ERCOT ingest history and pull ESIID data</div>
            </a>
            <a
              href="/admin/retail-rates"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">⚡ Retail Rates</div>
              <div className="text-sm text-brand-navy/60">Explore and manage retail rate data</div>
            </a>
            <a
              href="/admin/modules"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">📦 Modules</div>
              <div className="text-sm text-brand-navy/60">View available system modules</div>
            </a>
            <a
              href="/admin/database"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">🗄️ Database Explorer</div>
              <div className="text-sm text-brand-navy/60">Read-only database viewer with search and CSV export</div>
            </a>
            <a
              href="/admin/puct/reps"
              className="block p-4 border-2 border-brand-blue/20 rounded-lg hover:border-brand-blue hover:bg-brand-blue/5 transition-colors"
            >
              <div className="font-semibold text-brand-navy mb-1">📇 PUCT REP Directory</div>
              <div className="text-sm text-brand-navy/60">
                Upload the latest PUCT REP CSV to refresh the internal Retail Electric Provider list
              </div>
            </a>
          </div>
        </section>

        {/* Users Section */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">📋 Users</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Email</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Joined</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Entries</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Referrals</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center text-brand-navy/60">
                      No users found
                    </td>
                  </tr>
                ) : (
                  users.map(user => (
                    <tr key={user.id} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                      <td className="py-3 px-4 text-brand-navy">{user.email}</td>
                      <td className="py-3 px-4 text-brand-navy">{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td className="py-3 px-4 text-brand-navy">{user.entries?.length || 0}</td>
                      <td className="py-3 px-4 text-brand-navy">{user.referrals?.length || 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Commissions Section */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">💰 Commissions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">User</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Type</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Amount</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {commissions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center text-brand-navy/60">
                      No commissions found
                    </td>
                  </tr>
                ) : (
                  commissions.map(c => (
                    <tr key={c.id} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                      <td className="py-3 px-4 text-brand-navy">{c.user?.email || 'Unknown'}</td>
                      <td className="py-3 px-4 text-brand-navy">{c.type}</td>
                      <td className="py-3 px-4 text-brand-navy font-semibold">${c.amount.toFixed(2)}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          c.status === 'paid' ? 'bg-green-100 text-green-800' :
                          c.status === 'approved' ? 'bg-blue-100 text-blue-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Jackpot Section */}
        <section className="bg-brand-white rounded-lg p-6 mb-8 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">🎰 Jackpot Payouts</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">User</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Amount</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {jackpotPayouts.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-8 px-4 text-center text-brand-navy/60">
                      No jackpot payouts found
                    </td>
                  </tr>
                ) : (
                  jackpotPayouts.map(j => (
                    <tr key={j.id} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                      <td className="py-3 px-4 text-brand-navy">{j.user?.email || 'Unknown'}</td>
                      <td className="py-3 px-4 text-brand-navy font-semibold">${j.amount.toFixed(2)}</td>
                      <td className="py-3 px-4">
                        {j.paid ? (
                          <span className="text-green-600">✅ Paid</span>
                        ) : (
                          <span className="text-red-600">❌ Pending</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Finance Section */}
        <section className="bg-brand-white rounded-lg p-6 shadow-lg">
          <h2 className="text-2xl font-bold text-brand-navy mb-4">📊 Finance Records</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-navy/20">
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Type</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Source</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Amount</th>
                  <th className="text-left py-3 px-4 text-brand-navy font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {financeRecords.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center text-brand-navy/60">
                      No finance records found
                    </td>
                  </tr>
                ) : (
                  financeRecords.map(f => (
                    <tr key={f.id} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        f.type === 'income' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {f.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-brand-navy">{f.source}</td>
                    <td className="py-3 px-4 text-brand-navy font-semibold">${f.amount.toFixed(2)}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        f.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {f.status}
                      </span>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
} 