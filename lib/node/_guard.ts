export function assertNodeRuntime(): void {
  if (typeof process === 'undefined' || !process.versions?.node) {
    throw new Error('lib/node/* imported in a non-Node (Edge) runtime');
  }
}
