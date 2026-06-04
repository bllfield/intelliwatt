/** Canonical SMT slot count per calendar day (shared by window status, tail coverage, ledger). */
export const SMT_REQUIRED_SLOTS_PER_DAY = 96;

/** Tail heal / ledger completeness uses the same per-day slot target as canonical window status. */
export const SMT_TAIL_REQUIRED_INTERVALS_PER_DAY = SMT_REQUIRED_SLOTS_PER_DAY;
