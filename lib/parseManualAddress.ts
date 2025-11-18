/**
 * Parse a manual address string into structured components
 * This handles addresses entered manually without Google autocomplete
 */
function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeUnit(rawUnit: string | null): string | null {
  if (!rawUnit) return null;
  const cleaned = rawUnit.replace(/^[,\s]+/, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  if (cleaned.startsWith('#')) {
    const value = cleaned.slice(1).trim();
    return value ? `Apt ${value}` : null;
  }

  const lower = cleaned.toLowerCase();
  const knownPrefixes = ['apt', 'apartment', 'unit', 'suite', 'ste', 'building', 'bldg'];
  if (knownPrefixes.some((prefix) => lower.startsWith(prefix))) {
    return cleaned;
  }

  if (/^[a-z]/i.test(cleaned)) {
    return cleaned;
  }

  return `Apt ${cleaned}`;
}

export function parseManualAddress(addressString: string) {
  const trimmed = addressString.trim();
  
  // Try to parse common address formats
  // Format: "123 Main St, Apt 4B, Houston, TX 77001"
  // Format: "123 Main St, Suite 100, Houston, TX 77001"
  // Format: "123 Main St #4B Houston TX 77001"
  
  const addressComponents = [];
  
  const unitRegex =
    /(,?\s*(?:apt|apartment|unit|suite|ste|building|bldg)\s*\.?\s*[A-Za-z0-9#-]+(?:\s+[A-Za-z0-9#-]+)*)|(#\s*[A-Za-z0-9-]+)/i;
  const unitMatch = trimmed.match(unitRegex);
  const normalizedUnit = normalizeUnit(unitMatch ? unitMatch[0] : null);

  let withoutUnit = trimmed;
  if (unitMatch) {
    const pattern = new RegExp(`\\s*,?\\s*${escapeRegExp(unitMatch[0])}`, 'i');
    withoutUnit = withoutUnit.replace(pattern, '').replace(/\s{2,}/g, ' ').replace(/\s*,\s*,/g, ',').trim();
  }

  // Split by commas to get segments (without the unit)
  const segments = withoutUnit.split(',').map(s => s.trim()).filter(Boolean);
  
  if (segments.length >= 3) {
    // Typical format: "Street, City, State ZIP"
    const street = segments[0];
    const city = segments[1];
    const stateZip = segments[2];
    
    // Parse state and ZIP from last segment
    const stateZipMatch = stateZip.match(/^([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/i);
    let state = '';
    let zip = '';
    
    if (stateZipMatch) {
      state = stateZipMatch[1].toUpperCase();
      zip = stateZipMatch[2].replace('-', '');
    }
    
    // Add address components
    addressComponents.push({
      types: ['street_address'],
      long_name: street,
      short_name: street,
    });
    
    if (city) {
      addressComponents.push({
        types: ['locality'],
        long_name: city,
        short_name: city,
      });
    }
    
    if (state) {
      addressComponents.push({
        types: ['administrative_area_level_1'],
        long_name: state,
        short_name: state,
      });
    }
    
    if (zip) {
      addressComponents.push({
        types: ['postal_code'],
        long_name: zip,
        short_name: zip,
      });
    }
  } else {
    // Simple fallback - just the address string
    addressComponents.push({
      types: ['street_address'],
      long_name: withoutUnit,
      short_name: withoutUnit,
    });
  }

  if (normalizedUnit) {
    addressComponents.push({
      types: ['subpremise'],
      long_name: normalizedUnit,
      short_name: normalizedUnit,
    });
  }
  
  // Always add country
  addressComponents.push({
    types: ['country'],
    long_name: 'United States',
    short_name: 'US',
  });
  
  return {
    place_id: null,
    formatted_address: trimmed,
    address_components: addressComponents,
    geometry: {
      location: null
    }
  };
}

