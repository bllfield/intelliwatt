// Types are minimal to avoid importing Google types in the server bundle.
type AddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

export type GooglePlaceDetails = {
  place_id?: string;
  formatted_address?: string;
  address_components?: AddressComponent[];
  geometry?: {
    location?: { lat: () => number; lng: () => number } | { lat: number; lng: number };
  };
};

function pick(components: AddressComponent[] = [], type: string, useShort = false) {
  const c = components.find(ac => ac.types.includes(type));
  if (!c) return "";
  return useShort ? c.short_name : c.long_name;
}

export function normalizeGoogleAddress(details: GooglePlaceDetails, unitNumber?: string) {
  const c = details.address_components ?? [];
  const streetNumber = pick(c, "street_number");
  const route = pick(c, "route");
  const subpremiseFromGoogle = pick(c, "subpremise");
  const subpremise = (subpremiseFromGoogle && subpremiseFromGoogle.trim()) || unitNumber || null;
  const city = pick(c, "locality") || pick(c, "sublocality") || pick(c, "postal_town") || "";
  const state = pick(c, "administrative_area_level_1", true); // short_name: "TX"
  const postal = pick(c, "postal_code");
  const plus4 = pick(c, "postal_code_suffix") || "";
  const country = pick(c, "country", true) || "US";

  const line1 = [streetNumber, route].filter(Boolean).join(" ").trim();
  const [lat, lng] = (() => {
    const loc = details.geometry?.location;
    if (!loc) return [null, null] as const;
    // handle both function-style and plain numbers
    // @ts-ignore
    const latVal = typeof loc.lat === "function" ? loc.lat() : loc.lat;
    // @ts-ignore
    const lngVal = typeof loc.lng === "function" ? loc.lng() : loc.lng;
    return [latVal ?? null, lngVal ?? null] as const;
  })();

  return {
    placeId: details.place_id ?? null,
    formattedAddress: details.formatted_address ?? null,
    addressLine1: line1,
    addressLine2: subpremise,
    addressCity: city,
    addressState: state,
    addressZip5: postal?.slice(0, 5) || "",
    addressZip4: plus4 || null,
    addressCountry: country || "US",
    lat,
    lng,
    addressValidated: !!line1 && !!city && !!state && !!postal,
  };
}
