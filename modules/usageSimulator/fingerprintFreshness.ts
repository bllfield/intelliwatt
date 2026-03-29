/**
 * Section 13 freshness helpers: compare persisted sourceHash to freshly computed dependency hashes.
 */

export function fingerprintIsStaleForExpectedSourceHash(
  row: { sourceHash: string } | null | undefined,
  expectedSourceHash: string
): boolean {
  if (!row?.sourceHash) return true;
  return row.sourceHash !== expectedSourceHash;
}
