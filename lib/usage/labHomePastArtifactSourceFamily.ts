export type PastArtifactSourceFamily = "SMT" | "GREEN_BUTTON";

export const LAB_HOME_SINGLE_OCCUPANCY_OPS_NOTE =
  "Because GB and SMT currently share the same mutable lab home, the latest dual recalc determines what the admin/test leg contains. The lab home is single-occupancy by source family; GB recalc invalidates SMT lab proof state and SMT recalc invalidates GB lab proof state. Always run the source-specific dual recalc immediately before that source's acceptance proof." as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function detectPastArtifactSourceFamilyFromDataset(
  dataset: Record<string, unknown> | null | undefined
): PastArtifactSourceFamily | null {
  if (!dataset || typeof dataset !== "object") return null;
  const meta = asRecord(dataset.meta);
  const summary = asRecord(dataset.summary);
  const lockboxRunContext = asRecord(meta.lockboxRunContext);
  const candidates = [
    meta.actualSource,
    summary.source,
    lockboxRunContext.preferredActualSource,
    meta.preferredActualSource,
  ];
  for (const raw of candidates) {
    const normalized = String(raw ?? "").trim().toUpperCase();
    if (normalized === "GREEN_BUTTON" || normalized === "GREENBUTTON") return "GREEN_BUTTON";
    if (normalized === "SMT") return "SMT";
  }
  return null;
}

export function buildStaleLabHomeSourceFamilyMessage(args: {
  proofSourceType: PastArtifactSourceFamily;
  labArtifactSourceFamily: PastArtifactSourceFamily;
}): string {
  if (args.proofSourceType === "SMT" && args.labArtifactSourceFamily === "GREEN_BUTTON") {
    return "STALE_LAB_HOME_SOURCE_FAMILY: lab home currently contains GREEN_BUTTON artifacts; rerun SMT dual recalc before SMT proof.";
  }
  if (args.proofSourceType === "GREEN_BUTTON" && args.labArtifactSourceFamily === "SMT") {
    return "STALE_LAB_HOME_SOURCE_FAMILY: lab home currently contains SMT artifacts; rerun Green Button dual recalc before Green Button proof.";
  }
  return `STALE_LAB_HOME_SOURCE_FAMILY: proof expects ${args.proofSourceType} but lab home artifact is ${args.labArtifactSourceFamily}; rerun the matching source-specific dual recalc before proof.`;
}
