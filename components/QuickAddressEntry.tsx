'use client';

import { useState, useEffect } from 'react';

interface QuickAddressEntryProps {
  onAddressSubmitted: (address: string) => void;
  userAddress?: string;
}

export default function QuickAddressEntry({ onAddressSubmitted, userAddress }: QuickAddressEntryProps) {
  const [mounted, setMounted] = useState(false);
  const [address, setAddress] = useState(userAddress || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;

    setIsSubmitting(true);
    
    try {
      // Store the address in localStorage for persistence
      localStorage.setItem('intelliwatt_user_address', address);
      
      // Call the parent callback
      onAddressSubmitted(address);
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Error saving address:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="bg-brand-blue/10 p-4 rounded-lg border border-brand-blue/20">
        <div className="flex items-center justify-center">
          <div className="animate-pulse bg-brand-blue/20 h-4 w-48 rounded"></div>
        </div>
      </div>
    );
  }

  // If user already has an address, show a summary
  if (userAddress) {
    return (
      <div className="bg-green-50 p-4 rounded-lg border border-green-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
              <span className="text-white text-sm">✓</span>
            </div>
            <div>
              <p className="text-sm font-medium text-green-800">Service Address Connected</p>
              <p className="text-xs text-green-600">{userAddress}</p>
            </div>
          </div>
          <button
            onClick={() => onAddressSubmitted('')}
            className="text-xs text-green-600 hover:text-green-800 underline"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-brand-blue/10 p-4 rounded-lg border border-brand-blue/20">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 bg-brand-blue rounded-full flex items-center justify-center">
          <span className="text-white text-sm">⚡</span>
        </div>
        <div className="flex-1">
          <input
            type="text"
            placeholder="Enter your service address to get started..."
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-brand-blue/30 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue"
            disabled={isSubmitting}
          />
        </div>
        <button
          type="submit"
          disabled={!address.trim() || isSubmitting}
          className="bg-brand-blue text-white px-4 py-2 text-sm font-medium rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : 'Connect'}
        </button>
      </div>
    </form>
  );
}
