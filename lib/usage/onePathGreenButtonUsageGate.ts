import { getLatestUsableRawGreenButtonIdForHouse } from "@/modules/realUsageAdapter/greenButton";

export type OnePathGreenButtonUsageMissing = {
  ok: false;
  error: "green_button_usage_missing";
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
  const rawId = await getLatestUsableRawGreenButtonIdForHouse(houseId).catch(() => null);
  if (!rawId) {
    const label = args.contextLabel ? ` (${args.contextLabel})` : "";
    return {
      ok: false,
      error: "green_button_usage_missing",
      message: `Green Button usage is not persisted on this One Path home${label}. Upload and ingest Green Button on the test home before running Past Sim.`,
      houseId,
    };
  }
  return { ok: true };
}
