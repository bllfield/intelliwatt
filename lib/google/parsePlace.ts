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
  long_name: string;
  short_name: string;
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

function normalizeComponents(raw: any[]): AddressComponent[] {
  return raw.map((component) => {
    if (!component) {
      return { long_name: "", short_name: "", types: [] };
    }

    if (component.long_name !== undefined || component.short_name !== undefined) {
      return {
        long_name: component.long_name ?? "",
        short_name: component.short_name ?? component.long_name ?? "",
        types: component.types ?? [],
      };
    }

    const longText = component.longText ?? component.text ?? "";
    const shortText = component.shortText ?? component.text ?? longText;
    return {
      long_name: longText,
      short_name: shortText,
      types: component.types ?? [],
    };
  });
}

function pick(components: AddressComponent[], type: string, useShort = false): string {
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

  const rawComponents =
    (place as any)?.address_components ?? (place as any)?.addressComponents ?? [];
  const components = normalizeComponents(Array.isArray(rawComponents) ? rawComponents : []);
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

  const { lat, lng } = resolveLatLng((place as any)?.location ?? place.geometry?.location ?? null);

  const formattedAddress = (place as any)?.formattedAddress ?? place.formatted_address ?? line1;

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

function componentsFromParsed(parsed: ParsedPlace): AddressComponent[] {
  const components: AddressComponent[] = [];
  if (parsed.line1) {
    components.push({
      long_name: parsed.line1,
      short_name: parsed.line1,
      types: ['street_address'],
    });
  }
  if (parsed.line2) {
    components.push({
      long_name: parsed.line2,
      short_name: parsed.line2,
      types: ['subpremise'],
    });
  }
  if (parsed.city) {
    components.push({
      long_name: parsed.city,
      short_name: parsed.city,
      types: ['locality'],
    });
  }
  if (parsed.state) {
    components.push({
      long_name: parsed.state,
      short_name: parsed.state,
      types: ['administrative_area_level_1'],
    });
  }
  if (parsed.zip) {
    components.push({
      long_name: parsed.zip,
      short_name: parsed.zip,
      types: ['postal_code'],
    });
  }
  if (parsed.country) {
    components.push({
      long_name: parsed.country,
      short_name: parsed.country,
      types: ['country'],
    });
  }
  return components;
}

export function buildLegacyPlace(place: any, parsed: ParsedPlace | null): any | null {
  if (!place && !parsed) return null;

  const rawComponents =
    place?.address_components ?? place?.addressComponents ?? [];
  let components = normalizeComponents(Array.isArray(rawComponents) ? rawComponents : []);

  if ((!components || components.length === 0) && parsed) {
    components = componentsFromParsed(parsed);
  }

  const parsedLat = parsed?.lat ?? null;
  const parsedLng = parsed?.lng ?? null;

  const geometryLocation = (() => {
    if (parsedLat !== null && parsedLng !== null) {
      return { lat: parsedLat, lng: parsedLng };
    }
    const location = place?.location ?? place?.geometry?.location ?? null;
    if (!location) {
      return { lat: null, lng: null };
    }
    const { lat, lng } = resolveLatLng(location);
    return { lat, lng };
  })();

  return {
    place_id: place?.place_id ?? place?.placeId ?? place?.id ?? null,
    formatted_address:
      parsed?.formattedAddress ?? place?.formatted_address ?? place?.formattedAddress ?? parsed?.line1 ?? '',
    address_components: components,
    geometry: {
      location: geometryLocation,
    },
  };
}


