declare global {
  interface Window {
    google: {
      maps: {
        places: {
          Autocomplete: new (
            input: HTMLInputElement,
            options?: {
              types?: string[];
              componentRestrictions?: { country: string };
              fields?: string[];
            }
          ) => {
            addListener: (event: string, callback: () => void) => void;
            getPlace: () => {
              formatted_address?: string;
              address_components?: any[];
              place_id?: string;
            };
          };
          PlaceAutocompleteElement: new (options?: {
            types?: string[];
            componentRestrictions?: { country: string };
            fields?: string[];
          }) => HTMLElement & {
            addEventListener: (event: string, callback: (event: any) => void) => void;
          };
        };
      };
    };
  }
}

export {};
