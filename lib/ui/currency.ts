export function centsToUSD(cents: number) {
  const dollars = (cents ?? 0) / 100
  return dollars.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}
