'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { parseManualAddress } from '@/lib/parseManualAddress';
import { parseGooglePlace, buildLegacyPlace, type ParsedPlace } from '@/lib/google/parsePlace';

interface QuickAddressEntryProps {
  onAddressSubmitted: (address: string) => void;
  userAddress?: string;
  redirectOnSuccess?: boolean;
  onSaveResult?: (data: any) => void;
  houseIdForSave?: string | null;
  keepOtherHouses?: boolean;
  saveMode?: 'persist' | 'capture';
  heading?: string;
  subheading?: string;
  helperText?: string;
  className?: string;
  submitLabel?: string;
}

export default function QuickAddressEntry({
  onAddressSubmitted,
  userAddress,
  redirectOnSuccess = true,
  onSaveResult,
  houseIdForSave = null,
  keepOtherHouses = false,
  saveMode = 'persist',
  heading = 'Service address',
  subheading = 'We use your address to match the right utility and pull Smart Meter Texas data.',
  helperText,
  className,
  submitLabel = 'Save address',
}: QuickAddressEntryProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [address, setAddress] = useState(userAddress || '');
  const [unitNumber, setUnitNumber] = useState('');
  const [isRenter, setIsRenter] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!userAddress);
  const [placeDetails, setPlaceDetails] = useState<any>(null); // Store full Google Place object
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteElementRef = useRef<any>(null);
  const placeDetailsRef = useRef<any>(null);
  const parsedAddressRef = useRef<ParsedPlace | null>(null);
  const addressValueRef = useRef(address);
  const [useFallbackInput, setUseFallbackInput] = useState(true);
  const [reinitNonce, setReinitNonce] = useState(0);
  const wait = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs));

  const hasSavedAddress = Boolean(userAddress);
  const showForm = editing || !hasSavedAddress;
  const showSaved = hasSavedAddress && !editing;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Renter is an input to WattBuy offer eligibility (not a dashboard filter).
  // UX: default OFF (unchecked) unless the user explicitly opts in on this screen.

  useEffect(() => {
    if (!mounted || typeof window === 'undefined') {
      return;
    }

    const googleObj = (window as any).google;
    if (googleObj?.maps?.importLibrary) {
      setReinitNonce((prev) => prev + 1);
      return;
    }

    const script = document.querySelector<HTMLScriptElement>(
      'script[src*="maps.googleapis.com/maps/api/js"]',
    );
    if (!script) {
      const timeout = window.setTimeout(() => {
        const readyObj = (window as any).google;
        if (readyObj?.maps?.importLibrary) {
          setReinitNonce((prev) => prev + 1);
        }
      }, 1200);
      return () => window.clearTimeout(timeout);
    }

    const handleLoad = () => {
      if ((window as any).google?.maps?.importLibrary) {
        setReinitNonce((prev) => prev + 1);
      }
    };

    script.addEventListener('load', handleLoad);
    return () => {
      script.removeEventListener('load', handleLoad);
    };
  }, [mounted]);

  useEffect(() => {
    addressValueRef.current = address;
  }, [address]);

  useEffect(() => {
    if (!mounted) return;
    if (!showForm) return;
    let cancelled = false;
    let widget: any = null;
    let handleInput: ((event: any) => void) | null = null;
    let handleSelect: ((event: any) => void) | null = null;

    const googleObj = typeof window !== 'undefined' ? (window as any).google : undefined;

    const fallback = () => {
      setUseFallbackInput(true);
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
        widget.style.setProperty('--gmpx-color-surface-variant', '#ffffff');
        widget.style.setProperty('--gmpx-color-on-surface', '#0f172a');
        widget.style.setProperty('--gmpx-color-on-surface-variant', '#0f172a');
        widget.style.setProperty('--gmpx-color-on-primary', '#0f172a');
        widget.style.setProperty('--gmpx-color-on-secondary', '#0f172a');
        widget.style.setProperty('--gmpx-color-primary', '#1d4ed8');
        widget.style.setProperty('--gmpx-font-family', 'inherit');
        widget.style.setProperty('--gmpx-shape-corner-full', '0.75rem');
        widget.style.setProperty('--gmpx-typography-body1-text-color', '#0f172a');
        widget.style.setProperty('--gmpx-typography-body2-text-color', '#0f172a');
        widget.style.setProperty('--gmpx-typography-caption-text-color', '#0f172a');
        widget.style.setProperty('--gmpx-typography-headline6-text-color', '#0f172a');
        widget.style.setProperty('--gmpx-typography-subtitle1-text-color', '#0f172a');
        widget.style.setProperty('--gmpx-size-base', '48px');
        widget.style.setProperty('--gmpx-size-line-height', '1.4');
        widget.style.color = '#0f172a';
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
  }, [mounted, reinitNonce, showForm]);

  useEffect(() => {
    if (!mounted) return;
    if (!showForm) return;
    if (!useFallbackInput) return;

    const input = fallbackInputRef.current;
    if (!input) return;

    const googleObj = typeof window !== 'undefined' ? (window as any).google : undefined;
    const AutocompleteCtor = googleObj?.maps?.places?.Autocomplete;
    if (!AutocompleteCtor) {
      return;
    }

    let listener: any = null;
    let autocomplete: any = null;

    try {
      autocomplete = new AutocompleteCtor(input, {
        types: ['address'],
        fields: ['address_components', 'formatted_address', 'geometry'],
      });

      listener = autocomplete.addListener('place_changed', () => {
        try {
          const place = autocomplete.getPlace?.();
          const parsed = parseGooglePlace(place);
          if (!parsed || !parsed.line1 || !parsed.city || !parsed.state || !parsed.zip) {
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
          console.error('Places Autocomplete selection error', err);
          placeDetailsRef.current = null;
          parsedAddressRef.current = null;
          setPlaceDetails(null);
          setError('Unable to retrieve address details. Please enter the full address manually.');
        }
      });
    } catch (err) {
      console.warn('Failed to initialize classic Places Autocomplete:', err);
    }

    return () => {
      try {
        if (listener?.remove) listener.remove();
      } catch {
        // ignore
      }
    };
  }, [mounted, showForm, useFallbackInput]);

  useEffect(() => {
    if (!mounted) return;
    if (!userAddress) return;
    if (userAddress === addressValueRef.current) return;

    addressValueRef.current = userAddress;
    setAddress(userAddress);
    setEditing(false);
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

      if (saveMode === 'capture') {
        onAddressSubmitted(normalizedAddress);
        setError(null);
        placeDetailsRef.current = null;
        setPlaceDetails(null);
        parsedAddressRef.current = null;
        return;
      }

      // Save address to database using the new API
      console.log('Sending address save request:', {
        googlePlaceDetails: legacyPlace,
      });

      const response = await fetch('/api/address/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          houseId: houseIdForSave ?? null,
          googlePlaceDetails: legacyPlace,
          unitNumber: unitNumber.trim() || undefined,
          isRenter,
          keepOtherHouses,
        }),
      });

      console.log('Address save response:', response.status, response.statusText);

      if (!response.ok) {
        const error = await response.json();
        console.error('Address save failed:', error);
        throw new Error(error.error || 'Failed to save address');
      }

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
      setEditing(false);
      
      const savedEsiid = data?.address?.esiid ?? null;
      await wait(savedEsiid ? 800 : 2500);
      if (redirectOnSuccess) {
        router.push('/dashboard/api#smt');
      }
      if (onSaveResult) {
        onSaveResult(data);
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

  const baseClass =
    'rounded-2xl border border-[#00F0FF]/30 bg-brand-navy/95 p-6 text-brand-cyan shadow-[0_24px_70px_rgba(0,240,255,0.12)] sm:p-8';
  const containerClass = className ? `${baseClass} ${className}` : baseClass;

  const resetAddress = () => {
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
  };

  return (
    <div className={containerClass}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[#00F0FF]/70">
            {heading}
          </p>
          <p className="text-xs leading-relaxed text-[#9DFBFF]/75 max-w-xl">{subheading}</p>
          {helperText ? (
            <p className="text-[11px] leading-relaxed text-[#9DFBFF]/55">{helperText}</p>
          ) : null}
        </div>
        {showSaved ? (
          <button
            onClick={() => {
              resetAddress();
              setEditing(true);
            }}
            className="inline-flex items-center rounded-full border border-[#00F0FF]/30 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#00F0FF] transition hover:border-[#00F0FF] hover:text-white"
          >
            Change address
          </button>
        ) : null}
      </div>

      <div className="mt-6 space-y-5">
        {showSaved ? (
          <div className="rounded-xl border border-[#39FF14]/30 bg-[#39FF14]/10 px-4 py-4 text-sm text-[#39FF14] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="flex items-start gap-3">
              <div className="mt-1 flex h-7 w-7 items-center justify-center rounded-full border border-[#39FF14]/40 bg-[#39FF14]/15 text-xs font-bold text-[#39FF14]">
                ✓
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold uppercase tracking-wide">
                  Address on file
                </p>
                <p className="whitespace-pre-line text-xs text-[#39FF14]/80">{userAddress}</p>
              </div>
            </div>
          </div>
        ) : null}

        {showForm ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,2fr),minmax(0,1fr)]">
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-[#9DFBFF]/70">
                  Street address
                </label>
                <div className="relative rounded-xl border border-[#00F0FF]/20 bg-white/95 px-3 py-2 shadow-[0_10px_30px_rgba(0,240,255,0.08)]">
                  <div ref={containerRef} className="min-h-[46px]" />
                  {useFallbackInput && (
                    <input
                      ref={fallbackInputRef}
                      type="text"
                      placeholder="Start typing your service address..."
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
                      className="w-full border-none bg-transparent text-sm text-brand-navy placeholder-brand-navy/40 focus:outline-none"
                      disabled={isSubmitting}
                    />
                  )}
                  <input type="hidden" name="serviceAddress" value={address} readOnly />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-[#9DFBFF]/70">
                  Unit / apartment (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., Apt 1203"
                  value={unitNumber}
                  onChange={(e) => setUnitNumber(e.target.value)}
                  className="w-full rounded-xl border border-[#00F0FF]/20 bg-white/95 px-4 py-3 text-sm text-brand-navy placeholder-brand-navy/40 shadow-[0_10px_30px_rgba(0,240,255,0.08)] focus:outline-none focus:ring-2 focus:ring-[#00F0FF]/60"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-[#9DFBFF]/75 select-none">
              <input
                type="checkbox"
                checked={isRenter}
                onChange={(e) => setIsRenter(e.target.checked)}
                className="h-4 w-4 rounded border-[#00F0FF]/40 bg-white/95"
                disabled={isSubmitting}
              />
              I’m a renter (show renter-eligible plans)
            </label>

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] uppercase tracking-wide text-[#9DFBFF]/60">
                Saving this address updates your IntelliWatt dashboard and unlocks smart meter syncing.
              </p>
              <button
                type="submit"
                disabled={!address.trim() || isSubmitting}
                className="inline-flex items-center justify-center rounded-full border border-[#00F0FF]/60 bg-[#00F0FF]/15 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-[#00F0FF] transition hover:border-[#00F0FF] hover:bg-[#00F0FF]/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Saving…' : submitLabel}
              </button>
            </div>
          </form>
        ) : null}

        {error && !hasSavedAddress ? (
          <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}