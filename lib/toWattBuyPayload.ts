export type CanonicalAddress = {
  addressLine1: string;
  addressCity: string;
  addressState: string;
  addressZip5: string;
};

export function toWattBuyPayload(addr: CanonicalAddress) {
  return {
    address: addr.addressLine1,
    city: addr.addressCity,
    state: addr.addressState,
    zip: (addr.addressZip5 || "").slice(0, 5),
  };
}
