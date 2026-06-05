import { createHmac } from "node:crypto";

import { prisma } from "@/lib/db";
import {
  GREEN_BUTTON_INTERVAL_INGEST_VERSION,
  parseGreenButtonUploadParseSummary,
} from "@/lib/usage/greenButtonIngestContract";
import { resolveGreenButtonIntervalIngestReadiness } from "@/lib/usage/greenButtonIntervalReadiness";
import { isGreenButtonUploadParseError } from "@/lib/usage/greenButtonUploadStatus";
import type { RehydrateGreenButtonIntervalsResult } from "@/lib/usage/rehydrateGreenButtonIntervalsFromRaw";

const DEFAULT_TICKET_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_WAIT_TIMEOUT_MS = 240_000;

export type GreenButtonDropletConfig = {
  rehydrateUrl: string;
  secret: string;
};

function base64UrlEncode(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function resolveGreenButtonDropletConfig(): GreenButtonDropletConfig | null {
  const uploadUrl =
    process.env.GREEN_BUTTON_UPLOAD_URL ?? process.env.NEXT_PUBLIC_GREEN_BUTTON_UPLOAD_URL ?? null;
  const secret = process.env.GREEN_BUTTON_UPLOAD_SECRET ?? null;
  if (!uploadUrl || !secret) return null;
  const rehydrateUrl = uploadUrl.endsWith("/upload")
    ? `${uploadUrl.slice(0, -"/upload".length)}/rehydrate`
    : `${uploadUrl.replace(/\/$/, "")}/rehydrate`;
  return { rehydrateUrl, secret };
}

export function buildGreenButtonSignedTicket(args: {
  userId: string;
  houseId: string;
  rawId?: string | null;
  expiresAtMs?: number;
  secret?: string;
}) {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (args.expiresAtMs ?? DEFAULT_TICKET_MS));
  const payload = {
    v: 1,
    userId: args.userId,
    houseId: args.houseId,
    rawId: args.rawId?.trim() || undefined,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const secret = args.secret ?? process.env.GREEN_BUTTON_UPLOAD_SECRET ?? "";
  const payloadEncoded = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = createHmac("sha256", secret).update(payloadEncoded).digest("hex");
  return { payload, payloadEncoded, signature, expiresAt: expiresAt.toISOString() };
}

export async function waitForGreenButtonIngestCurrent(args: {
  houseId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const houseId = String(args.houseId ?? "").trim();
  const timeoutMs = args.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollIntervalMs = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const upload = await prisma.greenButtonUpload
      .findFirst({
        where: { houseId },
        orderBy: { createdAt: "desc" },
        select: { parseStatus: true },
      })
      .catch(() => null);

    if (upload?.parseStatus === "processing") {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    if (upload && isGreenButtonUploadParseError(upload.parseStatus)) {
      return { ok: false, error: "rehydrate_parse_error" };
    }

    const readiness = await resolveGreenButtonIntervalIngestReadiness(houseId);
    if (readiness.ready) {
      return { ok: true };
    }
    if (readiness.reason === "upload_parse_error") {
      return { ok: false, error: "rehydrate_parse_error" };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { ok: false, error: "rehydrate_timeout" };
}

export async function buildRehydrateSuccessFromHouse(
  houseId: string
): Promise<RehydrateGreenButtonIntervalsResult> {
  const readiness = await resolveGreenButtonIntervalIngestReadiness(houseId);
  if (!readiness.ready) {
    return { ok: false, error: readiness.reason };
  }

  const upload = await prisma.greenButtonUpload
    .findFirst({
      where: { houseId },
      orderBy: { createdAt: "desc" },
      select: { parseMessage: true },
    })
    .catch(() => null);
  const summary = parseGreenButtonUploadParseSummary(upload?.parseMessage ?? null);

  return {
    ok: true,
    intervalsWritten: summary?.normalizedIntervals ?? 0,
    intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION,
    coverageStartDateKey: summary?.coverageStartDateKey ?? "",
    coverageEndDateKey: summary?.coverageEndDateKey ?? "",
  };
}

export async function requestGreenButtonRehydrateOnDroplet(args: {
  houseId: string;
  userId: string;
  rawId?: string | null;
  waitForCompletion?: boolean;
  waitTimeoutMs?: number;
  config?: GreenButtonDropletConfig;
}): Promise<RehydrateGreenButtonIntervalsResult & { accepted?: boolean; processing?: boolean }> {
  const config = args.config ?? resolveGreenButtonDropletConfig();
  if (!config) {
    return { ok: false, error: "green_button_droplet_unavailable" };
  }

  const houseId = String(args.houseId ?? "").trim();
  const userId = String(args.userId ?? "").trim();
  if (!houseId || !userId) {
    return { ok: false, error: "missing_house_or_user" };
  }

  const ticket = buildGreenButtonSignedTicket({
    userId,
    houseId,
    rawId: args.rawId ?? null,
    secret: config.secret,
  });

  let response: Response;
  try {
    response = await fetch(config.rehydrateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload: ticket.payloadEncoded,
        signature: ticket.signature,
        rawId: args.rawId?.trim() || undefined,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      error: "droplet_rehydrate_request_failed",
    };
  }

  const json = (await response.json().catch(() => null)) as
    | (RehydrateGreenButtonIntervalsResult & { accepted?: boolean; processing?: boolean; error?: string })
    | null;

  if (response.status === 202 || json?.accepted || json?.processing) {
    if (args.waitForCompletion === false) {
      return {
        ok: true,
        accepted: true,
        processing: true,
        intervalsWritten: 0,
        intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION,
        coverageStartDateKey: "",
        coverageEndDateKey: "",
      };
    }
    const waited = await waitForGreenButtonIngestCurrent({
      houseId,
      timeoutMs: args.waitTimeoutMs,
    });
    if (!waited.ok) {
      return { ok: false, error: waited.error };
    }
    return buildRehydrateSuccessFromHouse(houseId);
  }

  if (!response.ok || !json?.ok) {
    return { ok: false, error: String(json?.error ?? "droplet_rehydrate_failed") };
  }

  return {
    ok: true,
    intervalsWritten: Number(json.intervalsWritten) || 0,
    intervalIngestVersion:
      Number(json.intervalIngestVersion) || GREEN_BUTTON_INTERVAL_INGEST_VERSION,
    coverageStartDateKey: String(json.coverageStartDateKey ?? ""),
    coverageEndDateKey: String(json.coverageEndDateKey ?? ""),
  };
}
