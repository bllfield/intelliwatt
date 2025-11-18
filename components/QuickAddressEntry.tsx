'use client';

import { useState, useEffect, useRef } from 'react';
import { parseManualAddress } from '@/lib/parseManualAddress';
import { parseGooglePlace, type ParsedPlace } from '@/lib/google/parsePlace';

interface QuickAddressEntryProps {
  onAddressSubmitted: (address: string) => void;
  userAddress?: string;
}

export default function QuickAddressEntry({ onAddressSubmitted, userAddress }: QuickAddressEntryProps) {
  const [mounted, setMounted] = useState(false);
  const [address, setAddress] = useState(userAddress || '');
  const [unitNumber, setUnitNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [consent, setConsent] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placeDetails, setPlaceDetails] = useState<any>(null); // Store full Google Place object
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autocompleteElementRef = useRef<any>(null);
  const placeDetailsRef = useRef<any>(null);
  const parsedAddressRef = useRef<ParsedPlace | null>(null);
  const addressValueRef = useRef(address);
  const [useFallbackInput, setUseFallbackInput] = useState(true);
  const [reinitNonce, setReinitNonce] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    addressValueRef.current = address;
  }, [address]);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    let widget: any = null;
    let handleInput: ((event: any) => void) | null = null;
    let handleSelect: ((event: any) => void) | null = null;

    const googleObj = typeof window !== 'undefined' ? (window as any).google : undefined;

    const fallback = () => {
      if (!useFallbackInput) {
        setUseFallbackInput(true);
      }
    };

    async function initAutocomplete() {
      if (!containerRef.current) {
        fallback();
        return;
      }

      if (!googleObj?.maps?.importLibrary) {
        console.warn('Google Maps importLibrary is not available.');
        fallback();
        return;
      }

      try {
        console.log('Debug: Initializing Google Maps PlaceAutocompleteElement...');
        // @ts-ignore - PlaceAutocompleteElement typings may not be available
        const { PlaceAutocompleteElement } = await googleObj.maps.importLibrary('places');

        if (cancelled || !PlaceAutocompleteElement) {
          fallback();
          return;
        }

        widget = new PlaceAutocompleteElement({
          types: ['address'],
        });

        const widgetClassName =
          'w-full px-4 py-3 text-sm bg-white/90 border border-white/30 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue text-brand-navy placeholder-brand-navy/60';
        widget.className = widgetClassName;
        widget.placeholder = 'Enter your service address...';

        if (addressValueRef.current) {
          widget.value = addressValueRef.current;
        }

        handleInput = (event: any) => {
          const value = event?.target?.value ?? '';
          addressValueRef.current = value;
          setAddress(value);
          parsedAddressRef.current = null;
          placeDetailsRef.current = null;
          setPlaceDetails(null);
          setError(null);
        };

        handleSelect = async (event: any) => {
          try {
            const prediction = event?.placePrediction;
            if (!prediction) return;
            const place = await prediction.toPlace();
            await place.fetchFields({
              fields: ['addressComponents', 'formattedAddress', 'location'],
            });

            const parsed = parseGooglePlace(place);
            if (!parsed || !parsed.line1 || !parsed.city || !parsed.state || !parsed.zip) {
              console.warn('Parsed place missing key fields', parsed);
              placeDetailsRef.current = null;
              parsedAddressRef.current = null;
              setPlaceDetails(null);
              setError('Unable to parse the selected address. Please complete the fields manually.');
              return;
            }

            setError(null);
            placeDetailsRef.current = place;
            parsedAddressRef.current = parsed;
            addressValueRef.current = parsed.formattedAddress;
            setAddress(parsed.formattedAddress);
            setPlaceDetails(place);
          } catch (err) {
            console.error('PlaceAutocompleteElement selection error', err);
            placeDetailsRef.current = null;
            parsedAddressRef.current = null;
            setPlaceDetails(null);
            setError('Unable to retrieve address details. Please enter the full address manually.');
          }
        };

        widget.addEventListener('input', handleInput);
        widget.addEventListener('gmp-select', handleSelect);

        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(widget);
        autocompleteElementRef.current = widget;
        if (useFallbackInput) {
          setUseFallbackInput(false);
        }
        console.log('Debug: PlaceAutocompleteElement initialized successfully');
      } catch (error) {
        console.warn('Failed to initialize PlaceAutocompleteElement:', error);
        fallback();
      }
    }

    void initAutocomplete();

    return () => {
      cancelled = true;
      const currentWidget = autocompleteElementRef.current;
      if (currentWidget) {
        if (handleInput) {
          currentWidget.removeEventListener('input', handleInput);
        }
        if (handleSelect) {
          currentWidget.removeEventListener('gmp-select', handleSelect);
        }
        if (containerRef.current?.contains(currentWidget)) {
          containerRef.current.removeChild(currentWidget);
        }
        autocompleteElementRef.current = null;
      }
    };
  }, [mounted, reinitNonce]);
  useEffect(() => {
    if (!mounted) return;
    if (!userAddress) return;
    if (userAddress === addressValueRef.current) return;

    addressValueRef.current = userAddress;
    setAddress(userAddress);
    parsedAddressRef.current = null;
    placeDetailsRef.current = null;
    setPlaceDetails(null);

    const widget = autocompleteElementRef.current;
    if (widget) {
      widget.value = userAddress;
    }
  }, [userAddress, mounted]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Debug: Submit button clicked', { address: address.trim(), consent, isSubmitting });
    setError(null);
    
    if (!address.trim() || !consent) {
      console.log('Debug: Validation failed', { 
        addressEmpty: !address.trim(), 
        consentMissing: !consent 
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      // Get user ID from dashboard API
      const userResponse = await fetch('/api/admin/user/dashboard');
      if (!userResponse.ok) {
        console.error('Failed to get user data:', userResponse.status, userResponse.statusText);
        throw new Error('User not authenticated');
      }
      const userData = await userResponse.json();
      console.log('User data:', userData);
      
      // Check if the current address matches what the user typed vs what Google selected
      // If placeDetails exists but the formatted address doesn't match what user typed, it's a manual entry
      let normalizedAddress = address.trim();
      let googlePlaceDetails = placeDetailsRef.current ?? placeDetails;
      let parsedAddress = parsedAddressRef.current;

      if (!googlePlaceDetails || !parsedAddress) {
        const manualPlace = parseManualAddress(normalizedAddress);
        googlePlaceDetails = manualPlace;
        placeDetailsRef.current = manualPlace;
        const parsedManual = parseGooglePlace(manualPlace as any);
        parsedAddress = parsedManual;
        parsedAddressRef.current = parsedManual;
      }

      if (parsedAddress?.formattedAddress) {
        normalizedAddress = parsedAddress.formattedAddress;
        setAddress(parsedAddress.formattedAddress);
      }

      if (
        !parsedAddress ||
        !parsedAddress.line1 ||
        !parsedAddress.city ||
        !parsedAddress.state ||
        !parsedAddress.zip
      ) {
        setError('Please enter the full service address, including city, state, and ZIP code.');
        setIsSubmitting(false);
        return;
      }

      // Save address to database using the new API
      console.log('Sending address save request:', {
        userId: userData.user?.email || 'unknown',
        houseId: null,
        googlePlaceDetails: googlePlaceDetails,
        smartMeterConsent: consent,
        smartMeterConsentDate: new Date().toISOString()
      });

      const response = await fetch('/api/address/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userData.user?.id || userData.user?.email || 'unknown',
          houseId: null,
          googlePlaceDetails: googlePlaceDetails,
          unitNumber: unitNumber.trim() || undefined,
          smartMeterConsent: consent,
          smartMeterConsentDate: new Date().toISOString()
        })
      });

      console.log('Address save response:', response.status, response.statusText);

      if (response.ok) {
        const data = await response.json();
        console.log('Address saved successfully:', data);
        
        // Store the address in localStorage for persistence
        localStorage.setItem('intelliwatt_user_address', normalizedAddress);
        
        // Call the parent callback
        onAddressSubmitted(normalizedAddress);
        setError(null);
        placeDetailsRef.current = null;
        setPlaceDetails(null);
        parsedAddressRef.current = null;
        
        // Address saved successfully - user can see the updated UI
      } else {
        const error = await response.json();
        console.error('Address save failed:', error);
        throw new Error(error.error || 'Failed to save address');
      }
    } catch (error) {
      console.error('Error saving address:', error);
      setError(error instanceof Error ? error.message : 'Failed to save address.');
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
            onClick={() => {
              const widget = autocompleteElementRef.current;
              if (widget && containerRef.current?.contains(widget)) {
                containerRef.current.removeChild(widget);
                autocompleteElementRef.current = null;
              }
              placeDetailsRef.current = null;
              parsedAddressRef.current = null;
              setPlaceDetails(null);
              setAddress('');
              addressValueRef.current = '';
              setUnitNumber('');
              setConsent(false);
              setUseFallbackInput(true);
              setReinitNonce((nonce) => nonce + 1);
              onAddressSubmitted('');
            }}
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
            <div className="relative">
              <div ref={containerRef} className="min-h-[44px]" />
              {useFallbackInput && (
                <input
                  type="text"
                  placeholder="Enter your service address..."
                  value={address}
                  onChange={(e) => {
                    const value = e.target.value;
                    addressValueRef.current = value;
                    setAddress(value);
                    parsedAddressRef.current = null;
                    placeDetailsRef.current = null;
                    setPlaceDetails(null);
                    setError(null);
                  }}
                  className="w-full px-4 py-3 text-sm bg-white/90 border border-white/30 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue text-brand-navy placeholder-brand-navy/60"
                  disabled={isSubmitting}
                />
              )}
              <input type="hidden" name="serviceAddress" value={address} readOnly />
            </div>
          </div>
          
          {/* Optional Unit/Apartment Number Field */}
          <div className="flex-1">
            <input
              type="text"
              placeholder="Unit/Apt # (optional)"
              value={unitNumber}
              onChange={(e) => setUnitNumber(e.target.value)}
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

      {error && (
        <p className="text-sm text-red-300">
          {error}
        </p>
      )}

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
              The IntelliWatt Rate Plan Analyzer is in final testing. You can
              <span className="font-semibold"> authorize Smart Meter Texas now</span> so your usage data is securely
              linked and ready. While we finish connections and squash bugs, we won&rsquo;t show results in the dashboard yet.
              As soon as everything is live, we&rsquo;ll <span className="font-semibold">email your personalized plan recommendation</span>.
              Thanks for joining the early waitlist and helping us launch this the right way!
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
