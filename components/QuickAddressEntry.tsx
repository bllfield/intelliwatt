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
  const [consent, setConsent] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim() || !consent) return;

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
      <div className="bg-white/10 p-6 rounded-lg border border-white/20">
        <div className="flex items-center justify-center">
          <div className="animate-pulse bg-white/20 h-4 w-48 rounded"></div>
        </div>
      </div>
    );
  }

  // If user already has an address, show a summary
  if (userAddress) {
    return (
      <div className="bg-green-500/20 p-6 rounded-lg border border-green-400/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
              <span className="text-white text-sm">✓</span>
            </div>
            <div>
              <p className="text-sm font-medium text-green-100">Service Address Connected</p>
              <p className="text-xs text-green-200">{userAddress}</p>
            </div>
          </div>
          <button
            onClick={() => onAddressSubmitted('')}
            className="text-xs text-green-200 hover:text-green-100 underline"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/10 p-6 rounded-lg border border-white/20">
      <form onSubmit={handleSubmit} className="space-y-4">
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
              className="w-full px-4 py-3 text-sm bg-white/90 border border-white/30 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue text-brand-navy placeholder-brand-navy/60"
              disabled={isSubmitting}
            />
          </div>
          <button
            type="submit"
            disabled={!address.trim() || !consent || isSubmitting}
            className="bg-brand-blue text-white px-6 py-3 text-sm font-medium rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Connecting...' : 'Connect'}
          </button>
        </div>

        {/* Smart Meter Consent */}
        <div className="space-y-3">
          <label className="flex items-start space-x-3 text-sm cursor-pointer group">
            <input 
              type="checkbox" 
              checked={consent} 
              onChange={() => setConsent(!consent)}
              className="mt-1 w-4 h-4 text-brand-blue bg-white border-white/30 rounded focus:ring-brand-blue focus:ring-2"
            />
            <span className="text-white group-hover:text-brand-blue transition-colors">
              I agree to allow IntelliWatt to securely access my Smart Meter Texas data for automatic plan optimization and savings calculations.
            </span>
          </label>

          {/* Terms of Service Link */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => setShowTerms(!showTerms)}
              className="text-xs text-white/80 hover:text-brand-blue underline transition-colors"
            >
              {showTerms ? 'Hide' : 'View'} Terms of Service & Privacy Policy
            </button>
          </div>

          {/* Terms Modal */}
          {showTerms && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 shadow-xl max-h-96 overflow-y-auto">
                <div className="text-center mb-4">
                  <h3 className="text-lg font-medium text-brand-navy">Terms of Service & Privacy Policy</h3>
                </div>
                <div className="text-sm text-brand-navy space-y-4">
                  <div>
                    <h4 className="font-semibold mb-2">Smart Meter Data Access</h4>
                    <p>By connecting your Smart Meter Texas account, you authorize IntelliWatt to:</p>
                    <ul className="list-disc list-inside mt-2 space-y-1">
                      <li>Access your ESIID (Electric Service Identifier)</li>
                      <li>Retrieve your current electricity plan details</li>
                      <li>Download your historical usage data</li>
                      <li>Analyze your consumption patterns for optimization</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2">Data Security</h4>
                    <p>Your data is encrypted and stored securely. We never share your personal information with third parties without your explicit consent.</p>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2">Service Purpose</h4>
                    <p>This data is used solely to provide you with personalized energy plan recommendations and help you save money on your electricity bills.</p>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2">Your Rights</h4>
                    <p>You can disconnect your Smart Meter access at any time through your dashboard settings. You may also request deletion of your data by contacting support.</p>
                  </div>
                </div>
                <div className="mt-6 text-center">
                  <button
                    onClick={() => setShowTerms(false)}
                    className="bg-brand-blue text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors"
                  >
                    I Understand
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
