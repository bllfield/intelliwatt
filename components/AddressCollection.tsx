'use client';

import { useState, useEffect } from 'react';

interface AddressData {
  address?: string;
  zipCode?: string;
  esiid?: string;
  addressValidated?: boolean;
  smartMeterConsent?: boolean;
  smartMeterConsentDate?: string;
}

export default function AddressCollection() {
  const [mounted, setMounted] = useState(false);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('TX');
  const [zip, setZip] = useState('');
  const [smartMeterConsent, setSmartMeterConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [existingData, setExistingData] = useState<AddressData | null>(null);

  useEffect(() => {
    setMounted(true);
    fetchExistingAddress();
  }, []);

  const fetchExistingAddress = async () => {
    try {
      const response = await fetch('/api/user/address');
      if (response.ok) {
        const data = await response.json();
        if (data.profile) {
          setExistingData(data.profile);
          setSaved(true);
          
          // Parse existing address if available
          if (data.profile.address) {
            const parts = data.profile.address.split(', ');
            if (parts.length >= 3) {
              setAddress(parts[0]);
              setCity(parts[1]);
              const stateZip = parts[2].split(' ');
              setState(stateZip[0]);
              setZip(stateZip[1] || '');
            }
          }
          
          if (data.profile.smartMeterConsent) {
            setSmartMeterConsent(true);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching existing address:', error);
    }
  };

  const handleSave = async () => {
    if (!address || !city || !zip) {
      alert('Please fill in all address fields');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/user/address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          city,
          state,
          zip,
          smartMeterConsent
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSaved(true);
        setExistingData(data.profile);
        alert(data.message);
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to save address');
      }
    } catch (error) {
      console.error('Error saving address:', error);
      alert('Failed to save address');
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) {
    return (
      <div className="bg-white p-6 rounded-xl border border-brand-navy shadow-lg">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded mb-4"></div>
          <div className="h-4 bg-gray-200 rounded mb-2"></div>
          <div className="h-4 bg-gray-200 rounded mb-4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-xl border border-brand-navy shadow-lg">
      <div className="flex items-center mb-4">
        <div className="w-8 h-8 bg-brand-blue rounded-full flex items-center justify-center mr-3">
          <span className="text-white text-sm">🏠</span>
        </div>
        <h3 className="text-xl font-bold text-brand-navy">Service Address</h3>
        {saved && (
          <span className="ml-auto text-green-600 text-sm font-medium">✓ Saved</span>
        )}
      </div>

      {existingData?.addressValidated && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center">
            <span className="text-green-600 mr-2">✓</span>
            <span className="text-green-800 text-sm font-medium">
              Address validated! ESIID: {existingData.esiid}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-brand-navy font-semibold mb-2">Street Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St"
            className="w-full px-4 py-3 rounded-lg bg-white border-2 border-brand-navy text-brand-navy placeholder-brand-navy/40 focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue transition-all duration-300"
            disabled={saved}
          />
        </div>

        <div>
          <label className="block text-brand-navy font-semibold mb-2">City</label>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Houston"
            className="w-full px-4 py-3 rounded-lg bg-white border-2 border-brand-navy text-brand-navy placeholder-brand-navy/40 focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue transition-all duration-300"
            disabled={saved}
          />
        </div>

        <div>
          <label className="block text-brand-navy font-semibold mb-2">State</label>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-white border-2 border-brand-navy text-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue transition-all duration-300"
            disabled={saved}
          >
            <option value="TX">Texas</option>
          </select>
        </div>

        <div>
          <label className="block text-brand-navy font-semibold mb-2">ZIP Code</label>
          <input
            type="text"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            placeholder="77001"
            className="w-full px-4 py-3 rounded-lg bg-white border-2 border-brand-navy text-brand-navy placeholder-brand-navy/40 focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue transition-all duration-300"
            disabled={saved}
          />
        </div>
      </div>

      <div className="mb-6">
        <label className="flex items-start space-x-3 text-sm cursor-pointer group">
          <input 
            type="checkbox" 
            checked={smartMeterConsent} 
            onChange={() => setSmartMeterConsent(!smartMeterConsent)}
            className="mt-1 w-4 h-4 text-brand-blue bg-white border-brand-navy rounded focus:ring-brand-blue focus:ring-2"
            disabled={saved && existingData?.smartMeterConsent}
          />
          <span className="text-brand-navy group-hover:text-brand-blue transition-colors">
            <strong>Smart Meter Texas Consent:</strong> I agree to allow IntelliWatt to securely access my Smart Meter Texas data for automatic plan optimization and savings calculations. This will enable us to pull your ESIID, usage history, and current plan details.
          </span>
        </label>
      </div>

      {!saved && (
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full bg-brand-blue text-white py-3 px-6 rounded-lg font-semibold hover:bg-brand-blue/90 focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-2 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Saving...' : 'Save Address & Consent'}
        </button>
      )}

      {saved && (
        <div className="text-center">
          <p className="text-brand-navy text-sm">
            Your address has been saved. We'll use this information to find the best energy plans for your location.
          </p>
          {existingData?.smartMeterConsent && (
            <p className="text-brand-blue text-sm mt-2 font-medium">
              ✓ Smart Meter Texas consent provided on {new Date(existingData.smartMeterConsentDate!).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
