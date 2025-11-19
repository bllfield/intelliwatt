'use client';

import { useState, useEffect } from 'react';

interface EntryData {
  id: string;
  type: string;
  amount: number;
  createdAt: string;
}

export default function EntriesPage() {
  const [entries, setEntries] = useState<EntryData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const mockEntries: EntryData[] = [
      { id: '1', type: 'Profile Completed', amount: 1, createdAt: new Date().toISOString() },
      { id: '2', type: 'Smart Meter Connected', amount: 1, createdAt: new Date().toISOString() },
      { id: '3', type: 'Appliances Tagged', amount: 2, createdAt: new Date().toISOString() },
    ];
    setEntries(mockEntries);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-white flex items-center justify-center">
        <div className="animate-pulse text-brand-navy">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-white">
      {/* Hero Section */}
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>
        
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-brand-white mb-6">
            Jackpot <span className="text-brand-blue">Entries</span>
          </h1>
          <p className="text-xl text-brand-white mb-8 max-w-2xl mx-auto leading-relaxed">
            Track your entries and see your chances of winning the monthly jackpot drawing.
          </p>
        </div>
      </section>

      {/* Entries Overview */}
      <section className="py-16 px-4 bg-brand-white">
        <div className="max-w-4xl mx-auto">
          <div className="bg-brand-white p-8 rounded-2xl border-2 border-brand-navy shadow-lg mb-8">
            <h2 className="text-2xl font-bold text-brand-navy mb-6">Your Entries Summary</h2>
            
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              {entries.length === 0 ? (
                <div className="col-span-2 text-center py-8">
                  <div className="text-brand-slate text-lg">No entries yet. Complete tasks to earn jackpot entries!</div>
                </div>
              ) : (
                entries.map(entry => (
                  <div key={entry.id} className="flex items-center justify-between p-4 bg-brand-navy border border-brand-navy rounded-lg">
                    <div className="flex items-center space-x-3">
                      <span className="text-brand-blue text-xl">🔲</span>
                      <span className="text-brand-white font-medium">{entry.type}</span>
                    </div>
                    <span className="bg-brand-white text-brand-navy px-3 py-1 rounded-full text-sm font-semibold">
                      {entry.amount} {entry.amount === 1 ? 'Entry' : 'Entries'}
                    </span>
                  </div>
                ))
              )}
              
              <div className="flex items-center justify-between p-4 bg-brand-navy border border-brand-navy rounded-lg">
                <div className="flex items-center space-x-3">
                  <span className="text-brand-blue text-xl">🔲</span>
                  <span className="text-brand-white font-medium">Referred Friends</span>
                </div>
                <span className="bg-brand-white text-brand-navy px-3 py-1 rounded-full text-sm font-semibold">5+ Entries</span>
              </div>
            </div>
          </div>
          
          <div className="bg-brand-navy p-6 rounded-2xl text-center border-2 border-brand-navy">
            <p className="text-brand-blue font-bold text-lg mb-2">Total Entries Earned</p>
            <p className="text-brand-blue text-4xl font-bold">
              {entries.reduce((total, entry) => total + entry.amount, 0)}
            </p>
            <p className="text-brand-blue text-sm mt-2">Keep completing actions to earn more entries!</p>
          </div>
        </div>
      </section>

      {/* How to Earn More */}
      <section className="py-16 px-4 bg-brand-navy">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-brand-white text-center mb-12">
            How to <span className="text-brand-blue">Earn More</span> Entries
          </h2>
          
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-brand-white p-6 rounded-2xl border-2 border-brand-navy">
              <h3 className="text-xl font-bold text-brand-navy mb-4">Complete Your Profile</h3>
              <p className="text-brand-navy mb-4">Add your home details and preferences to earn your first entry.</p>
              <button className="bg-brand-navy text-brand-blue font-bold py-2 px-4 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">
                Complete Profile
              </button>
            </div>
            
            <div className="bg-brand-white p-6 rounded-2xl border-2 border-brand-navy">
              <h3 className="text-xl font-bold text-brand-navy mb-4">Connect Smart Meter</h3>
              <p className="text-brand-navy mb-4">Link your Smart Meter Texas account for automatic data access.</p>
              <button className="bg-brand-navy text-brand-blue font-bold py-2 px-4 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">
                Connect Meter
              </button>
            </div>
            
            <div className="bg-brand-white p-6 rounded-2xl border-2 border-brand-navy">
              <h3 className="text-xl font-bold text-brand-navy mb-4">Tag Appliances</h3>
              <p className="text-brand-navy mb-4">Add your major appliances to get more accurate recommendations.</p>
              <button className="bg-brand-navy text-brand-blue font-bold py-2 px-4 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">
                Add Appliances
              </button>
            </div>
            
            <div className="bg-brand-white p-6 rounded-2xl border-2 border-brand-navy">
              <h3 className="text-xl font-bold text-brand-navy mb-4">Refer Friends</h3>
              <p className="text-brand-navy mb-4">Invite friends and family to earn entries for each successful referral.</p>
              <button className="bg-brand-navy text-brand-blue font-bold py-2 px-4 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300">
                Invite Friends
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
} 