export type ParsedPlace = {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  lat?: number | null;
  lng?: number | null;
  formattedAddress: string;
};

type AddressComponent = {
  long_name?: string;
  short_name?: string;
  types: string[];
};

type PlaceResultLike = {
  formatted_address?: string;
  address_components?: AddressComponent[];
  geometry?: {
    location?:
      | { lat: () => number; lng: () => number }
      | { lat?: number; lng?: number }
      | null;
  };
};

function pick(
  components: AddressComponent[] | undefined,
  type: string,
  useShort = false,
): string {
  if (!components) return "";
  const component = components.find((c) => c.types.includes(type));
  if (!component) return "";
  const value = useShort ? component.short_name : component.long_name;
  return (value ?? "").trim();
}

function resolveLatLng(location: any) {
  if (!location) {
    return { lat: null, lng: null };
  }

  if (typeof (location as any).lat === "function" && typeof (location as any).lng === "function") {
    return {
      lat: (location as { lat: () => number }).lat(),
      lng: (location as { lng: () => number }).lng(),
    };
  }

  const lat = (location as { lat?: number })?.lat ?? null;
  const lng = (location as { lng?: number })?.lng ?? null;
  return { lat, lng };
}

export function parseGooglePlace(place: PlaceResultLike | null | undefined): ParsedPlace | null {
  if (!place) return null;

  const components = place.address_components ?? [];
  if (components.length === 0) {
    return null;
  }

  const streetNumber = pick(components, "street_number", true);
  const route = pick(components, "route");
  const subpremise = pick(components, "subpremise") || null;

  const city =
    pick(components, "locality") ||
    pick(components, "sublocality") ||
    pick(components, "postal_town") ||
    "";

  const state = pick(components, "administrative_area_level_1", true);
  const zip = pick(components, "postal_code", true);
  const country = pick(components, "country", true);

  const line1 = [streetNumber, route].filter(Boolean).join(" ").trim();

  const { lat, lng } = resolveLatLng(place.geometry?.location ?? null);

  const formattedAddress = place.formatted_address ?? line1;

  return {
    line1,
    line2: subpremise,
    city,
    state,
    zip,
    country,
    lat,
    lng,
    formattedAddress,
  };
}


