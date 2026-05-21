import {
  resolveSmtLedgerDateKeysForPastSim,
  type SmtDayLedgerSnapshot,
} from "@/lib/usage/smtDayCoverageLedger";
import {
  filterLedgerIncompleteMeterDateKeysToSlotIncomplete,
  loadSmtWindowDayStatus,
} from "@/lib/usage/smtWindowStatus";

export type PastSimSmtLedgerPrep = {
  smtDayLedgerSnapshot: SmtDayLedgerSnapshot | null;
  pendingSmtIntervalDateKeys: Set<string>;
  ledgerIncompleteMeterDateKeys: Set<string>;
};

const EMPTY_PREP: PastSimSmtLedgerPrep = {
  smtDayLedgerSnapshot: null,
  pendingSmtIntervalDateKeys: new Set(),
  ledgerIncompleteMeterDateKeys: new Set(),
};

/**
 * Shared SMT ledger keys for Past Sim producers (admin One Path + user usageSimulator).
 * Applies slot-complete filter so DST fall-back days match Usage (`smtWindowStatus`).
 */
export async function preparePastSimSmtLedgerDateKeys(args: {
  esiid: string | null;
  coverageStartDate: string;
  coverageEndDate: string;
  canonicalDateKeys: readonly string[];
  reconcile?: boolean;
}): Promise<PastSimSmtLedgerPrep> {
  const esiid = String(args.esiid ?? "").trim();
  if (!esiid) return { ...EMPTY_PREP, pendingSmtIntervalDateKeys: new Set(), ledgerIncompleteMeterDateKeys: new Set() };

  const smtLedgerForSim = await resolveSmtLedgerDateKeysForPastSim({
    esiid,
    coverageStartDate: args.coverageStartDate,
    coverageEndDate: args.coverageEndDate,
    reconcile: args.reconcile ?? true,
  }).catch(() => null);
  if (!smtLedgerForSim) {
    return { ...EMPTY_PREP, pendingSmtIntervalDateKeys: new Set(), ledgerIncompleteMeterDateKeys: new Set() };
  }

  const canonicalSet = new Set(args.canonicalDateKeys);
  const pendingSmtIntervalDateKeys = new Set(
    Array.from(smtLedgerForSim.pendingDateKeys).filter((dk) => canonicalSet.has(dk))
  );
  let ledgerIncompleteMeterDateKeys = new Set(
    Array.from(smtLedgerForSim.incompleteMeterDateKeys).filter((dk) => canonicalSet.has(dk))
  );
  if (ledgerIncompleteMeterDateKeys.size > 0) {
    const slotStatus = await loadSmtWindowDayStatus({
      esiid,
      dateKeys: Array.from(ledgerIncompleteMeterDateKeys),
    }).catch(() => null);
    if (slotStatus) {
      ledgerIncompleteMeterDateKeys = new Set(
        filterLedgerIncompleteMeterDateKeysToSlotIncomplete({
          incompleteMeterDateKeys: ledgerIncompleteMeterDateKeys,
          byDate: slotStatus.byDate,
        })
      );
    }
  }

  return {
    smtDayLedgerSnapshot: smtLedgerForSim.ledger,
    pendingSmtIntervalDateKeys,
    ledgerIncompleteMeterDateKeys,
  };
}
