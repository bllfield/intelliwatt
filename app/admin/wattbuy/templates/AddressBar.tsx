"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseManualAddress } from "@/lib/parseManualAddress";
import { parseGooglePlace, type ParsedPlace } from "@/lib/google/parsePlace";

type Props = {
  value: ParsedPlace | null;
  onChange: (next: ParsedPlace | null) => void;
};

export default function AddressBar({ value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<any>(null);
  const [mounted, setMounted] = useState(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const label = useMemo(() => {
    if (!value) return "";
    const parts = [value.line1, value.line2, `${value.city}, ${value.state} ${value.zip}`].filter(Boolean);
    return parts.join(" ");
  }, [value]);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    let widget: any = null;

    const googleObj = (window as any)?.google;
    const fallback = () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      widgetRef.current = null;
    };

    async function init() {
      if (!containerRef.current) return;
      if (!googleObj?.maps?.importLibrary) {
        fallback();
        return;
      }
      try {
        // @ts-ignore
        const { PlaceAutocompleteElement } = await googleObj.maps.importLibrary("places");
        if (cancelled || !PlaceAutocompleteElement) {
          fallback();
          return;
        }
        widget = new PlaceAutocompleteElement({ types: ["address"] });
        widget.className =
          "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none";
        widget.placeholder = "Filter by service address (Google autocomplete)…";

        const onSelect = async (event: any) => {
          try {
            const prediction = event?.placePrediction;
            if (!prediction) return;
            const place = await prediction.toPlace();
            await place.fetchFields({ fields: ["addressComponents", "formattedAddress", "location"] });
            const parsed = parseGooglePlace(place);
            if (!parsed?.line1 || !parsed?.city || !parsed?.state || !parsed?.zip) {
              setError("Unable to parse address. Please enter it manually.");
              return;
            }
            setError(null);
            setManual("");
            onChange(parsed);
          } catch {
            setError("Unable to retrieve address details. Please enter it manually.");
          }
        };

        widget.addEventListener("gmp-select", onSelect);

        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(widget);
        widgetRef.current = widget;
      } catch {
        fallback();
      }
    }

    void init();
    return () => {
      cancelled = true;
      const w = widgetRef.current;
      if (w && containerRef.current?.contains(w)) {
        try {
          containerRef.current.removeChild(w);
        } catch {
          // ignore
        }
      }
      widgetRef.current = null;
    };
  }, [mounted, onChange]);

  function submitManual() {
    const raw = manual.trim();
    if (!raw) return;
    const place = parseManualAddress(raw);
    const parsed = parseGooglePlace(place as any);
    if (!parsed?.line1 || !parsed?.city || !parsed?.state || !parsed?.zip) {
      setError("Please enter a full address including city, state, and ZIP.");
      return;
    }
    setError(null);
    onChange(parsed);
  }

  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium">Address filter (WattBuy offers for a home)</div>
        {value ? (
          <button
            className="text-xs rounded-full border px-3 py-1 hover:bg-gray-50"
            onClick={() => {
              setError(null);
              setManual("");
              onChange(null);
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        <div ref={containerRef} />

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Manual fallback: 9514 Santa Paula Dr, Fort Worth, TX 76116"
            className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm"
          />
          <button
            className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-2 text-sm font-semibold hover:bg-gray-100"
            onClick={submitManual}
          >
            Apply
          </button>
        </div>

        {value ? (
          <div className="text-xs text-gray-600">
            Active: <span className="font-medium">{label}</span>
          </div>
        ) : (
          <div className="text-xs text-gray-500">Optional: set this to show only templates for offers currently available at that address.</div>
        )}

        {error ? <div className="text-xs text-red-700">{error}</div> : null}
      </div>
    </div>
  );
}


