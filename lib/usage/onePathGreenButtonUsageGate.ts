import { resolveGreenButtonIntervalIngestReadiness } from "@/lib/usage/greenButtonIntervalReadiness";

export type OnePathGreenButtonUsageMissing = {
  ok: false;
  error: "green_button_usage_missing" | "green_button_ingest_stale";
  message: string;
  houseId: string;
};

export function greenButtonUploadHasPersistedUsage(
  upload: Record<string, unknown> | null | undefined
): boolean {
  if (!upload) return false;
  if (upload.hasPersistedUsageIntervals === true) return true;
  const intervalCount = Number(upload.intervalCount ?? 0);
  return Number.isFinite(intervalCount) && intervalCount > 0;
}

/** Fail-closed: admin GREEN_BUTTON requires persisted intervals on this house (no source-house donor). */
export async function assertOnePathGreenButtonPersistedUsage(args: {
  houseId: string;
  contextLabel?: string;
}): Promise<{ ok: true } | OnePathGreenButtonUsageMissing> {
  const houseId = String(args.houseId ?? "").trim();
  if (!houseId) {
    return {
      ok: false,
      error: "green_button_usage_missing",
      message: "Green Button mode requires a house with a persisted Green Button upload.",
      houseId: "",
    };
  }
  const readiness = await resolveGreenButtonIntervalIngestReadiness(houseId);
  if (!readiness.ready) {
    const label = args.contextLabel ? ` (${args.contextLabel})` : "";
    if (readiness.reason === "ingest_stale") {
      return {
        ok: false,
        error: "green_button_ingest_stale",
        message: `${readiness.message}${label}`,
        houseId,
      };
    }
    return {
      ok: false,
      error: "green_button_usage_missing",
      message:
        readiness.reason === "upload_parse_error"
          ? `Green Button upload did not complete successfully${label}.`
          : `Green Button usage is not persisted on this One Path home${label}. Upload and ingest Green Button on the test home before running Past Sim.`,
      houseId,
    };
  }
  return { ok: true };
}
