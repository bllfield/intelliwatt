/** Phase 3A compatibility facade — canonical owner: modules/manualUsage/prefill.ts */
export {
  buildManualUsageStageOneResolvedSeeds,
  deriveAnnualSeed,
  deriveMonthlySeedFromActual,
  hasUsableAnnualPayload,
  hasUsableMonthlyPayload,
  reanchorGapfillManualStageOnePayload,
  resolveGapfillSyntheticAnchorEndDate,
  resolveManualUsageStageOnePayloadForMode,
  resolveSeedAnchorEndDate,
  resolveSharedManualStageOneContract,
} from "@/modules/manualUsage/prefill";

export type {
  ManualUsageStageOnePayloadSource,
  ManualUsageStageOneResolvedPayload,
  ManualUsageStageOneResolvedSeeds,
  ManualUsageStageOneSeedSourceMode,
} from "@/modules/manualUsage/prefill";
