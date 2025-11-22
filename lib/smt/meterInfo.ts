import { prisma } from "@/lib/db";

const DROPLET_WEBHOOK_URL = (process.env.DROPLET_WEBHOOK_URL || "").trim();
const DROPLET_WEBHOOK_SECRET = (
  process.env.DROPLET_WEBHOOK_SECRET || process.env.INTELLIWATT_WEBHOOK_SECRET || ""
).trim();
const SMT_METERINFO_ENABLED = process.env.SMT_METERINFO_ENABLED === "true";

type QueueParams = {
  houseId: string;
  esiid: string;
};

export async function queueMeterInfoForHouse(params: QueueParams): Promise<void> {
  const { houseId, esiid } = params;
  if (!SMT_METERINFO_ENABLED) {
    console.log("[SMT] meterInfo queue skipped (SMT_METERINFO_ENABLED != true)", {
      houseId,
      esiid,
    });
    return;
  }

  const trimmedEsiid = (esiid || "").toString().trim();
  if (!trimmedEsiid) {
    console.warn("[SMT] meterInfo queue: missing ESIID", { houseId, esiid });
    return;
  }

  try {
    const prismaAny = prisma as any;
    await prismaAny.smtMeterInfo.upsert({
      where: {
        esiid_houseId: { esiid: trimmedEsiid, houseId },
      },
      create: {
        esiid: trimmedEsiid,
        houseId,
        status: "pending",
      },
      update: {
        status: "pending",
      },
    });
  } catch (err) {
    console.error("[SMT] meterInfo upsert failed (pending)", { houseId, trimmedEsiid, err });
    return;
  }

  if (!DROPLET_WEBHOOK_URL || !DROPLET_WEBHOOK_SECRET) {
    console.warn("[SMT] meterInfo queue: droplet webhook not configured", {
      hasUrl: !!DROPLET_WEBHOOK_URL,
      hasSecret: !!DROPLET_WEBHOOK_SECRET,
    });
    return;
  }

  try {
    const body = JSON.stringify({
      reason: "smt_meter_info",
      esiid: trimmedEsiid,
      houseId,
      ts: new Date().toISOString(),
    });

    await fetch(DROPLET_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-droplet-webhook-secret": DROPLET_WEBHOOK_SECRET,
        "x-intelliwatt-secret": DROPLET_WEBHOOK_SECRET,
      },
      body,
    });
  } catch (err) {
    console.error("[SMT] meterInfo queue: droplet request failed", {
      houseId,
      trimmedEsiid,
      err,
    });
  }
}

type SavePayload = {
  houseId?: string | null;
  esiid: string;
  meterNumber?: string | null;
  meterData?: Record<string, any> | null;
  rawPayload?: any;
  errorMessage?: string | null;
  status?: "pending" | "complete" | "error";
};

export async function saveMeterInfoFromDroplet(payload: SavePayload) {
  const prismaAny = prisma as any;
  const esiid = (payload.esiid || "").toString().trim();
  if (!esiid) {
    throw new Error("esiid is required");
  }

  const meterData =
    payload.meterData || (payload.rawPayload && payload.rawPayload.MeterData) || null;
  const status =
    payload.status ??
    (payload.errorMessage ? "error" : meterData || payload.meterNumber ? "complete" : "pending");

  const data = {
    houseId: payload.houseId ?? null,
    esiid,
    meterNumber:
      payload.meterNumber ??
      meterData?.utilityMeterId ??
      meterData?.meterSerialNumber ??
      null,
    transId: payload.rawPayload?.trans_id ?? null,
    utilityCompanyId: meterData?.utilityCompanyId ?? null,
    meterSerialNumber: meterData?.meterSerialNumber ?? null,
    utilityMeterId: meterData?.utilityMeterId ?? null,
    kwhMeterMultiplier:
      typeof meterData?.KWHMeterMultiplier === "number"
        ? meterData.KWHMeterMultiplier
        : meterData?.KWHMeterMultiplier
        ? Number.parseInt(meterData.KWHMeterMultiplier, 10)
        : null,
    configuredChannels: meterData?.configuredChannels ?? null,
    manufacturerName: meterData?.manufacturerName ?? null,
    meterClass: meterData?.meterClass ?? null,
    intervalSetting: meterData?.intervalSetting ?? null,
    reverseFlowHandling: meterData?.reverseFlowHandling ?? null,
    dgChannel: meterData?.DGChannel ?? null,
    disconnect: meterData?.disconnect ?? null,
    meterStatus: meterData?.meterStatus ?? null,
    meterPhases: meterData?.meterPhases ?? null,
    meterModel: meterData?.meterModel ?? null,
    testDate: meterData?.testDate ?? null,
    installationDate: meterData?.installationDate ?? null,
    initialProvisionDate: meterData?.initialProvisionDate ?? null,
    lastUpdatedRaw: meterData?.LastUpdated ?? null,
    communicationIndicator: meterData?.communicationIndicator ?? null,
    instrumentRated: meterData?.instrumentRated ?? null,
    currentTransformersRatio: meterData?.currentTransformersRatio ?? null,
    potentialTransformersRatio: meterData?.potentialTransformersRatio ?? null,
    esiFirmwareVersion: meterData?.esiFirmwareVersion ?? null,
    hanProtocol: meterData?.HANProtocol ?? null,
    smartEnergyProfile: meterData?.smartEnergyProfile ?? null,
    status,
    errorMessage: payload.errorMessage ?? null,
    rawPayload: payload.rawPayload ?? (meterData ? { MeterData: meterData } : null),
  };

  let record;
  if (payload.houseId) {
    record = await prismaAny.smtMeterInfo.upsert({
      where: {
        esiid_houseId: { esiid, houseId: payload.houseId },
      },
      create: data,
      update: data,
    });
  } else {
    const existing = await prismaAny.smtMeterInfo.findFirst({
      where: { esiid, houseId: null },
    });
    if (existing) {
      record = await prismaAny.smtMeterInfo.update({
        where: { id: existing.id },
        data,
      });
    } else {
      record = await prismaAny.smtMeterInfo.create({ data });
    }
  }

  return record;
}

