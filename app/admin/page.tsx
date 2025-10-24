'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Head from 'next/head';

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

  // Mock data for testing
  const mockUsers: User[] = [
    {
      id: '1',
      email: 'user1@example.com',
      createdAt: '2024-01-15T10:00:00Z',
      entries: [{ id: '1' }, { id: '2' }],
      referrals: [{ id: '1' }]
    },
    {
      id: '2',
      email: 'user2@example.com',
      createdAt: '2024-01-20T14:30:00Z',
      entries: [{ id: '3' }],
      referrals: []
    }
  ];

  const mockCommissions: Commission[] = [
    {
      id: '1',
      userId: '1',
      type: 'plan-switch',
      amount: 25.00,
      status: 'paid',
      user: mockUsers[0]
    },
    {
      id: '2',
      userId: '2',
      type: 'referral',
      amount: 15.00,
      status: 'pending',
      user: mockUsers[1]
    }
  ];

  const mockJackpot: JackpotPayout[] = [
    {
      id: '1',
      userId: '1',
      amount: 100.00,
      paid: false,
      user: mockUsers[0]
    }
  ];

  const mockFinance: FinanceRecord[] = [
    {
      id: '1',
      type: 'income',
      source: 'commission',
      amount: 40.00,
      status: 'paid'
    },
    {
      id: '2',
      type: 'expense',
      source: 'jackpot',
      amount: 100.00,
      status: 'pending'
    }
  ];

  useEffect(() => {
    setMounted(true);
    // Simulate loading
    setTimeout(() => {
      setLoading(false);
    }, 1000);
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

  const totalCommissions = mockCommissions.reduce((sum, r) => sum + r.amount, 0);
  const pendingJackpot = mockJackpot.filter(j => !j.paid).length;
  const totalFinance = mockFinance.reduce((sum, f) => sum + (f.type === 'income' ? f.amount : -f.amount), 0);

  return (
    <>
      <Head>
        <title>Admin Dashboard - IntelliWatt™</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
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
            <div className="text-2xl font-bold text-brand-navy">{mockUsers.length}</div>
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
                {mockUsers.map(user => (
                  <tr key={user.id} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                    <td className="py-3 px-4 text-brand-navy">{user.email}</td>
                    <td className="py-3 px-4 text-brand-navy">{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td className="py-3 px-4 text-brand-navy">{user.entries?.length || 0}</td>
                    <td className="py-3 px-4 text-brand-navy">{user.referrals?.length || 0}</td>
                  </tr>
                ))}
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
                {mockCommissions.map(c => (
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
                ))}
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
                {mockJackpot.map(j => (
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
                ))}
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
                {mockFinance.map(f => (
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
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
} 