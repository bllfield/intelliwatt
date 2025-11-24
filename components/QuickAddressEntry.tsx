'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { parseManualAddress } from '@/lib/parseManualAddress';
import { parseGooglePlace, buildLegacyPlace, type ParsedPlace } from '@/lib/google/parsePlace';

interface QuickAddressEntryProps {
  onAddressSubmitted: (address: string) => void;
  userAddress?: string;
}

export default function QuickAddressEntry({ onAddressSubmitted, userAddress }: QuickAddressEntryProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [address, setAddress] = useState(userAddress || '');
  const [unitNumber, setUnitNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placeDetails, setPlaceDetails] = useState<any>(null); // Store full Google Place object
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autocompleteElementRef = useRef<any>(null);
  const placeDetailsRef = useRef<any>(null);
  const parsedAddressRef = useRef<ParsedPlace | null>(null);
  const addressValueRef = useRef(address);
  const [useFallbackInput, setUseFallbackInput] = useState(true);
  const [reinitNonce, setReinitNonce] = useState(0);
  const wait = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs));

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
          'w-full px-4 py-3 text-sm bg-white border border-brand-blue/30 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-brand-blue text-brand-navy placeholder-brand-navy/60';
        widget.className = widgetClassName;
        widget.style.setProperty('--gmpx-color-surface', '#ffffff');
        widget.style.setProperty('--gmpx-color-on-surface', '#0f172a'); // slate-900
        widget.style.setProperty('--gmpx-color-primary', '#1d4ed8');
        widget.style.setProperty('--gmpx-font-family', 'inherit');
        widget.style.setProperty('--gmpx-shape-corner-full', '0.75rem');
        widget.style.setProperty('--gmpx-typography-body1-text-color', '#0f172a');
        widget.style.setProperty('--gmpx-typography-body2-text-color', '#0f172a');
        widget.style.setProperty('--gmpx-typography-caption-text-color', '#0f172a');
        widget.style.setProperty('--gmpx-size-base', '48px');
        widget.style.setProperty('--gmpx-size-line-height', '1.4');
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
    console.log('Debug: Submit button clicked', { address: address.trim(), isSubmitting });
    setError(null);
    
    if (!address.trim()) {
      console.log('Debug: Validation failed', { addressEmpty: !address.trim() });
      return;
    }

    setIsSubmitting(true);
    
    try {
      let normalizedAddress = address.trim();
      let parsedAddress = parsedAddressRef.current;
      let placeForSubmit = placeDetailsRef.current;

      if (!parsedAddress || !placeForSubmit) {
        const manualPlace = parseManualAddress(normalizedAddress);
        placeDetailsRef.current = manualPlace;
        const parsedManual = parseGooglePlace(manualPlace as any);
        parsedAddress = parsedManual;
        parsedAddressRef.current = parsedManual;
        placeForSubmit = manualPlace;
      }

      if (!parsedAddress) {
        setError('Please enter the full service address, including city, state, and ZIP code.');
        setIsSubmitting(false);
        return;
      }

      if (parsedAddress.formattedAddress) {
        normalizedAddress = parsedAddress.formattedAddress;
        setAddress(parsedAddress.formattedAddress);
        addressValueRef.current = parsedAddress.formattedAddress;
      }

      let legacyPlace = buildLegacyPlace(placeForSubmit, parsedAddress);
      if (!legacyPlace) {
        const manualPlace = parseManualAddress(normalizedAddress);
        legacyPlace = manualPlace;
        const parsedManual = parseGooglePlace(manualPlace as any);
        if (parsedManual) {
          parsedAddress = parsedManual;
          parsedAddressRef.current = parsedManual;
        }
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

      const unitValue = unitNumber.trim();
      if (unitValue) {
        parsedAddress = { ...parsedAddress, line2: unitValue };
        parsedAddressRef.current = parsedAddress;
        const components = Array.isArray(legacyPlace?.address_components)
          ? legacyPlace.address_components.filter(
              (component: any) => !component.types?.includes('subpremise'),
            )
          : [];
        components.push({
          long_name: unitValue,
          short_name: unitValue,
          types: ['subpremise'],
        });
        legacyPlace = {
          ...legacyPlace,
          address_components: components,
        };
      }

      if (parsedAddress.formattedAddress) {
        legacyPlace = {
          ...legacyPlace,
          formatted_address: parsedAddress.formattedAddress,
        };
      }

      // Save address to database using the new API
      console.log('Sending address save request:', {
        googlePlaceDetails: legacyPlace,
      });

      const response = await fetch('/api/address/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          houseId: null,
          googlePlaceDetails: legacyPlace,
          unitNumber: unitNumber.trim() || undefined,
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
        
        const savedEsiid = data?.address?.esiid ?? null;
        await wait(savedEsiid ? 800 : 2500);
        router.push('/dashboard/api#smt');
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="w-8 h-8 bg-brand-blue rounded-full flex items-center justify-center self-start sm:self-center">
            <span className="text-white text-sm">⚡</span>
          </div>
          <div className="flex-1 w-full">
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
          <div className="flex-1 w-full sm:w-auto">
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
            disabled={!address.trim() || isSubmitting}
            className="w-full sm:w-auto bg-brand-blue text-white px-6 py-3 text-sm font-medium rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Connecting...' : 'Connect'}
          </button>
        </div>

      {error && (
        <p className="text-sm text-red-300">
          {error}
        </p>
      )}

      </form>
    </div>
  );
}
