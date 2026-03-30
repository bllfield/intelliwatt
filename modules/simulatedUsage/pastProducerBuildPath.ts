/**
 * Shared Past producer path kinds. Kept server-agnostic so tests can import without `server-only` chains.
 * Architecture contract: cold_build and recalc use the same pre-DB producer implementation (no separate truth path).
 */
export type PastProducerBuildPathKind = "cold_build" | "recalc" | "lab_validation";

export function normalizePastProducerBuildPathKind(kind: PastProducerBuildPathKind): PastProducerBuildPathKind {
  return kind === "cold_build" ? "recalc" : kind;
}
