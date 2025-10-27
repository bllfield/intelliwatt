/**
 * Parse a manual address string into structured components
 * This handles addresses entered manually without Google autocomplete
 */
export function parseManualAddress(addressString: string) {
  const trimmed = addressString.trim();
  
  // Try to parse common address formats
  // Format: "123 Main St, Apt 4B, Houston, TX 77001"
  // Format: "123 Main St, Suite 100, Houston, TX 77001"
  // Format: "123 Main St #4B Houston TX 77001"
  
  const addressComponents = [];
  
  // Split by commas to get segments
  const segments = trimmed.split(',').map(s => s.trim());
  
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
      long_name: trimmed,
      short_name: trimmed,
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

