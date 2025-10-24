declare global {
  interface Window {
    google: {
      maps: {
        places: {
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
