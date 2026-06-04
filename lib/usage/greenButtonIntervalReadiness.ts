/**
 * Fail-closed gate: do not serve Green Button intervals until ingest v1 pipeline has run.
 */

import { prisma } from "@/lib/db";
import {
  GREEN_BUTTON_INTERVAL_INGEST_VERSION,
  isGreenButtonIntervalIngestCurrent,
  parseGreenButtonUploadParseSummary,
} from "@/lib/usage/greenButtonIngestContract";
import { isGreenButtonUploadParseError } from "@/lib/usage/greenButtonUploadStatus";
import { getLatestUsableRawGreenButtonIdForHouse } from "@/modules/realUsageAdapter/greenButton";

export type GreenButtonIntervalIngestNotReadyReason =
  | "missing_house"
  | "no_persisted_intervals"
  | "upload_parse_error"
  | "ingest_stale";

export type GreenButtonIntervalIngestReadiness =
  | {
      ready: true;
      houseId: string;
      rawId: string;
      intervalIngestVersion: number;
    }
  | {
      ready: false;
      houseId: string;
      reason: GreenButtonIntervalIngestNotReadyReason;
      message: string;
      rawId?: string | null;
      parseStatus?: string | null;
      observedIngestVersion?: number | null;
    };

export const GREEN_BUTTON_INGEST_STALE_USER_MESSAGE =
  "Green Button intervals need to be re-processed. Re-upload the file on Droplet or run rehydrate from raw, then retry.";

export async function resolveGreenButtonIntervalIngestReadiness(
  houseId: string
): Promise<GreenButtonIntervalIngestReadiness> {
  const id = String(houseId ?? "").trim();
  if (!id) {
    return {
      ready: false,
      houseId: "",
      reason: "missing_house",
      message: "House id is required for Green Button interval reads.",
    };
  }

  const rawId = await getLatestUsableRawGreenButtonIdForHouse(id).catch(() => null);
  if (!rawId) {
    return {
      ready: false,
      houseId: id,
      reason: "no_persisted_intervals",
      message: "No persisted Green Button intervals for this home.",
      rawId: null,
    };
  }

  const upload = await prisma.greenButtonUpload
    .findFirst({
      where: { houseId: id },
      orderBy: { createdAt: "desc" },
      select: { parseStatus: true, parseMessage: true },
    })
    .catch(() => null);

  if (upload && isGreenButtonUploadParseError(upload.parseStatus)) {
    return {
      ready: false,
      houseId: id,
      reason: "upload_parse_error",
      message: "Latest Green Button upload did not complete successfully.",
      rawId,
      parseStatus: upload.parseStatus,
    };
  }

  const parseMessage = upload?.parseMessage ?? null;
  if (!isGreenButtonIntervalIngestCurrent(parseMessage)) {
    const summary = parseGreenButtonUploadParseSummary(parseMessage);
    return {
      ready: false,
      houseId: id,
      reason: "ingest_stale",
      message: GREEN_BUTTON_INGEST_STALE_USER_MESSAGE,
      rawId,
      parseStatus: upload?.parseStatus ?? null,
      observedIngestVersion: summary?.intervalIngestVersion ?? null,
    };
  }

  return {
    ready: true,
    houseId: id,
    rawId,
    intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION,
  };
}

export async function isGreenButtonIntervalIngestReadyForHouse(houseId: string): Promise<boolean> {
  const readiness = await resolveGreenButtonIntervalIngestReadiness(houseId);
  return readiness.ready;
}
